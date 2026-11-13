/*!
 * EmailEditor – dependency-free drag & drop email template builder.
 * Blocks: Text (rich), Image (upload / URL), Custom HTML.
 *
 *   const editor = new EmailEditor('#editor', {
 *     design: savedJson,                       // optional, from editor.getDesign()
 *     onChange: design => {},                  // fires after every edit (debounced)
 *     onImageUpload: async file => 'https://…' // optional: upload to your server/CDN, return public URL
 *   });
 *   editor.getHTML();    // email-ready, table-based, inline-styled HTML  -> send this
 *   editor.getDesign();  // JSON                                          -> store this in your DB
 *   editor.load(json);   // restore a saved design
 */
(function (global) {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
  const clone = o => JSON.parse(JSON.stringify(o));
  const ex = (cmd, val) => document.execCommand(cmd, false, val);

  const ICONS = {
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/></svg>',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>'
  };
  const LABELS = { text: 'Text', image: 'Image', html: 'Custom HTML' };
  const FONTS = [['Arial, Helvetica, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'], ['Verdana, Geneva, sans-serif', 'Verdana'], ['Tahoma, sans-serif', 'Tahoma'], ["'Trebuchet MS', sans-serif", 'Trebuchet MS'], ["'Courier New', monospace", 'Courier New']];
  const SWATCHES = ['#111827', '#dc2626', '#ea580c', '#0f766e', '#2563eb', '#7c3aed', '#ffffff'];

  const DEFAULTS = {
    text: { html: '<h2>Your headline</h2><p>Click here to edit this text. Select words to format them with the toolbar on the right.</p>', fontSize: 16, lineHeight: 1.5, color: '#1f2937', align: 'left', bg: '', padding: 24 },
    image: { src: '', alt: '', link: '', width: 100, align: 'center', padding: 0 },
    html: { code: '<div style="padding:24px;text-align:center;background:#e3f4f2;color:#0f4c47;font-family:Arial,sans-serif">\n  <strong>Custom HTML block</strong><br>Edit this code in the panel on the right.\n</div>' }
  };

  /* Strip scripts, event handlers and javascript: URLs. Email clients drop them anyway. */
  function clean(html) {
    const d = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
    d.querySelectorAll('script,iframe,object,embed,form,base,meta,link').forEach(n => n.remove());
    d.body.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
      if (/^on/i.test(a.name) || (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*(javascript:|data:text\/html)/i.test(a.value))) n.removeAttribute(a.name);
    }));
    return d.body.innerHTML;
  }

  class EmailEditor {
    constructor(root, opts = {}) {
      this.root = typeof root === 'string' ? $(root) : root;
      this.opts = Object.assign({ sanitize: true, width: 600, onChange: null, onImageUpload: null }, opts);
      this.design = { settings: { width: this.opts.width, pageBg: '#eef0f4', contentBg: '#ffffff', font: FONTS[0][0] }, blocks: [] };
      this.sel = null; this.drag = null; this.mobile = false; this.hist = []; this.hi = -1;
      this._build();
      if (opts.design) this.design = this._norm(opts.design);
      this._renderAll(); this._push();
    }

    /* ---------- public API ---------- */
    getDesign() { return clone(this.design); }
    load(d) { this.design = this._norm(d); this.sel = null; this._renderAll(); this._push(); }
    getHTML() {
      const s = this.design.settings, w = s.width;
      const rows = this.design.blocks.map(b => {
        const p = b.props;
        if (b.type === 'text') return `<tr><td class="ee-c" style="${this._textStyle(p)}">${p.html}</td></tr>`;
        if (b.type === 'image') return p.src ? `<tr><td align="${p.align}" style="padding:${p.padding}px;text-align:${p.align}">${this._imgHTML(p)}</td></tr>` : '';
        return `<tr><td>${this.opts.sanitize ? clean(p.code) : p.code}</td></tr>`;
      }).join('\n');
      return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email</title>
<style>body{margin:0;padding:0}img{border:0;max-width:100%;height:auto}.ee-c h1,.ee-c h2,.ee-c h3,.ee-c p,.ee-c ul{margin:0 0 12px}.ee-c>:last-child{margin-bottom:0}@media(max-width:${w}px){.ee-wrap{width:100%!important}}</style></head>
<body style="margin:0;padding:0;background:${s.pageBg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.pageBg}"><tr><td align="center" style="padding:24px 8px">
<table role="presentation" class="ee-wrap" width="${w}" cellpadding="0" cellspacing="0" border="0" style="width:${w}px;max-width:100%;background:${s.contentBg};font-family:${s.font}">
${rows}
</table></td></tr></table></body></html>`;
    }
    undo() { this._flush(); if (this.hi > 0) { this.hi--; this._restore(); } }
    redo() { this._flush(); if (this.hi < this.hist.length - 1) { this.hi++; this._restore(); } }

    /* ---------- build ---------- */
    _build() {
      const r = this.root; r.classList.add('ee');
      r.innerHTML = `
        <div class="ee-bar">
          <div class="ee-brand">Template editor</div>
          <div class="ee-group">
            <button class="ee-btn" data-act="undo" title="Undo">&#8630;</button>
            <button class="ee-btn" data-act="redo" title="Redo">&#8631;</button>
            <span class="ee-sep"></span>
            <button class="ee-btn is-on" data-act="desktop">Desktop</button>
            <button class="ee-btn" data-act="mobile">Mobile</button>
          </div>
          <div class="ee-group">
            <button class="ee-btn" data-act="import">Import JSON</button>
            <button class="ee-btn" data-act="save">Save JSON</button>
            <button class="ee-btn" data-act="preview">Preview</button>
            <button class="ee-btn ee-primary" data-act="export">Export HTML</button>
          </div>
        </div>
        <aside class="ee-side"><h4>Blocks</h4><div class="ee-pal"></div><p class="ee-hint">Drag a block onto the email, or click it to add at the end.</p></aside>
        <main class="ee-stage"><div class="ee-canvas"></div></main>
        <aside class="ee-props"></aside>`;
      this.canvas = $('.ee-canvas', r); this.stage = $('.ee-stage', r); this.propsEl = $('.ee-props', r);

      const pal = $('.ee-pal', r);
      ['text', 'image', 'html'].forEach(t => {
        const i = h('div', 'ee-tile', ICONS[t] + `<span>${LABELS[t]}</span>`);
        i.draggable = true; i.dataset.type = t; pal.appendChild(i);
      });
      pal.addEventListener('dragstart', e => {
        const t = e.target.closest('.ee-tile'); if (!t) return;
        this.drag = { kind: 'new', type: t.dataset.type };
        e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', t.dataset.type);
      });
      pal.addEventListener('click', e => { const t = e.target.closest('.ee-tile'); if (t) this._insert(t.dataset.type, this.design.blocks.length); });

      const c = this.canvas, st = this.stage;
      c.addEventListener('dragstart', e => {
        const hd = e.target.closest && e.target.closest('.ee-handle'); if (!hd) return;
        const bl = hd.closest('.ee-block');
        this.drag = { kind: 'move', id: bl.dataset.id };
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', bl.dataset.id);
        e.dataTransfer.setDragImage(bl, 24, 24); bl.classList.add('is-drag');
      });
      st.addEventListener('dragover', e => {
        if (!this.drag) return; e.preventDefault();
        e.dataTransfer.dropEffect = this.drag.kind === 'new' ? 'copy' : 'move';
        this._showDrop(this._dropIndex(e.clientY));
      });
      st.addEventListener('dragleave', e => { if (!st.contains(e.relatedTarget)) this._hideDrop(); });
      st.addEventListener('drop', e => {
        if (!this.drag) return; e.preventDefault();
        let i = this._dropIndex(e.clientY); this._hideDrop();
        const d = this.drag; this.drag = null;
        if (d.kind === 'new') return this._insert(d.type, i);
        const bl = this.design.blocks, from = bl.findIndex(b => b.id === d.id); if (from < 0) return;
        const [b] = bl.splice(from, 1); if (from < i) i--; bl.splice(i, 0, b);
        this.sel = b.id; this._renderCanvas(); this._renderProps(); this._push();
      });
      r.addEventListener('dragend', () => { this.drag = null; this._hideDrop(); c.querySelectorAll('.is-drag').forEach(x => x.classList.remove('is-drag')); });

      c.addEventListener('click', e => {
        if (e.target.closest('a')) e.preventDefault();
        const bl = e.target.closest('.ee-block'); if (!bl) return;
        const id = bl.dataset.id, bt = e.target.closest('[data-a]');
        if (bt) return this._action(bt.dataset.a, id);
        if (e.target.closest('.ee-ph')) this._pickImage(id);
        this._select(id);
      });
      st.addEventListener('click', e => { if (e.target === st || e.target === c) this._select(null); });
      r.addEventListener('click', e => { const b = e.target.closest('.ee-bar [data-act]'); if (b) this._bar(b.dataset.act); });
    }

    _norm(d) {
      return {
        settings: Object.assign({}, this.design.settings, d.settings),
        blocks: (d.blocks || []).filter(b => DEFAULTS[b.type]).map(b => ({ id: b.id || uid(), type: b.type, props: Object.assign({}, DEFAULTS[b.type], b.props) }))
      };
    }
    _get(id) { return this.design.blocks.find(b => b.id === id); }
    _renderAll() { this._renderCanvas(); this._renderProps(); this._updUndo(); }

    /* ---------- history ---------- */
    _changed() { clearTimeout(this._t); this._t = setTimeout(() => { this._t = null; this._push(); }, 350); }
    _flush() { if (this._t) this._push(); }
    _push() {
      clearTimeout(this._t); this._t = null;
      const s = JSON.stringify(this.design);
      if (this.hist[this.hi] === s) return;
      this.hist = this.hist.slice(0, this.hi + 1); this.hist.push(s); this.hi++;
      if (this.hist.length > 100) { this.hist.shift(); this.hi--; }
      this._updUndo();
      if (this.opts.onChange) this.opts.onChange(this.getDesign());
    }
    _restore() {
      this.design = JSON.parse(this.hist[this.hi]);
      if (!this._get(this.sel)) this.sel = null;
      this._renderAll();
      if (this.opts.onChange) this.opts.onChange(this.getDesign());
    }
    _updUndo() {
      const u = $('[data-act=undo]', this.root), r = $('[data-act=redo]', this.root);
      if (u) u.disabled = this.hi <= 0; if (r) r.disabled = this.hi >= this.hist.length - 1;
    }

    /* ---------- canvas ---------- */
    _renderCanvas() {
      const s = this.design.settings, c = this.canvas;
      c.style.width = (this.mobile ? 375 : s.width) + 'px';
      c.style.background = s.contentBg; c.style.fontFamily = s.font;
      this.stage.style.background = s.pageBg;
      c.innerHTML = '';
      if (!this.design.blocks.length) c.appendChild(h('div', 'ee-empty', 'Drag a block here to start your email'));
      this.design.blocks.forEach(b => c.appendChild(this._blockEl(b)));
    }
    _textStyle(p) {
      return `padding:${p.padding}px;${p.bg ? `background:${p.bg};` : ''}font-size:${p.fontSize}px;line-height:${p.lineHeight};color:${p.color};text-align:${p.align}`;
    }
    _imgHTML(p) {
      const px = Math.round((this.design.settings.width - 2 * p.padding) * p.width / 100);
      const img = `<img src="${esc(p.src)}" alt="${esc(p.alt)}" width="${px}" style="display:inline-block;width:${p.width}%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">`;
      return p.link ? `<a href="${esc(p.link)}" target="_blank" style="text-decoration:none">${img}</a>` : img;
    }
    _blockEl(b) {
      const el = h('div', 'ee-block' + (b.id === this.sel ? ' is-sel' : '')); el.dataset.id = b.id;
      el.innerHTML = `<div class="ee-tools"><span class="ee-handle" draggable="true" title="Drag to move">&#10303;</span><span class="ee-tag">${LABELS[b.type]}</span><button data-a="up" title="Move up">&uarr;</button><button data-a="down" title="Move down">&darr;</button><button data-a="dup" title="Duplicate">&#10064;</button><button data-a="del" title="Delete">&#10005;</button></div>`;
      const body = h('div', 'ee-body'), p = b.props;
      if (b.type === 'text') {
        body.contentEditable = 'true';
        body.setAttribute('style', this._textStyle(p));
        body.innerHTML = p.html;
        body.addEventListener('input', () => { p.html = body.innerHTML; this._changed(); });
        body.addEventListener('focus', () => this._select(b.id));
        body.addEventListener('paste', e => { e.preventDefault(); ex('insertText', (e.clipboardData || window.clipboardData).getData('text/plain')); });
      } else if (b.type === 'image') {
        body.setAttribute('style', `padding:${p.padding}px;text-align:${p.align}`);
        body.innerHTML = p.src ? this._imgHTML(p) : `<div class="ee-ph">${ICONS.image}<span>Click to add an image</span></div>`;
      } else {
        body.classList.add('ee-htmlb');
        body.attachShadow({ mode: 'open' }).innerHTML = this.opts.sanitize ? clean(p.code) : p.code; // shadow root keeps user CSS from leaking into the editor
      }
      el.appendChild(body); return el;
    }
    _refresh(b) {
      const old = this.canvas.querySelector(`[data-id="${b.id}"]`);
      if (old) old.replaceWith(this._blockEl(b));
      this._changed();
    }
    _select(id) {
      if (this.sel === id) return;
      this.sel = id;
      this.canvas.querySelectorAll('.ee-block').forEach(el => el.classList.toggle('is-sel', el.dataset.id === id));
      this._renderProps();
    }
    _insert(type, idx) {
      const b = { id: uid(), type, props: clone(DEFAULTS[type]) };
      this.design.blocks.splice(idx, 0, b); this.sel = b.id;
      this._renderCanvas(); this._renderProps(); this._push();
      const el = this.canvas.querySelector(`[data-id="${b.id}"]`); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    _action(a, id) {
      const bl = this.design.blocks, i = bl.findIndex(b => b.id === id); if (i < 0) return;
      if (a === 'del') { bl.splice(i, 1); if (this.sel === id) this.sel = null; }
      else if (a === 'dup') { const c = { id: uid(), type: bl[i].type, props: clone(bl[i].props) }; bl.splice(i + 1, 0, c); this.sel = c.id; }
      else if (a === 'up' && i > 0) [bl[i - 1], bl[i]] = [bl[i], bl[i - 1]];
      else if (a === 'down' && i < bl.length - 1) [bl[i + 1], bl[i]] = [bl[i], bl[i + 1]];
      this._renderCanvas(); this._renderProps(); this._push();
    }
    _dropIndex(y) {
      const els = [...this.canvas.querySelectorAll('.ee-block')];
      for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
      return els.length;
    }
    _showDrop(i) {
      if (!this.dropEl) this.dropEl = h('div', 'ee-drop');
      this.canvas.insertBefore(this.dropEl, this.canvas.querySelectorAll('.ee-block')[i] || null);
    }
    _hideDrop() { if (this.dropEl) this.dropEl.remove(); }

    /* ---------- images ---------- */
    _pickImage(id) {
      const b = this._get(id); if (!b) return;
      const f = h('input'); f.type = 'file'; f.accept = 'image/*';
      f.onchange = async () => {
        const file = f.files[0]; if (!file) return;
        try {
          const url = this.opts.onImageUpload ? await this.opts.onImageUpload(file)
            : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
          b.props.src = url; if (!b.props.alt) b.props.alt = file.name.replace(/\.[^.]+$/, '');
          this._refresh(b); this._push(); if (this.sel === id) this._renderProps();
        } catch (err) { console.error(err); this._toast('Image upload failed. Try again.'); }
      };
      f.click();
    }

    /* ---------- properties panel ---------- */
    _field(label, input) { const l = h('label', 'ee-f'); l.appendChild(h('span', '', label)); l.appendChild(input); return l; }
    _in(type, val, fn, attrs = {}) {
      const i = h('input'); i.type = type; i.value = val;
      Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v));
      i.addEventListener('input', () => fn(type === 'range' ? +i.value : i.value)); return i;
    }
    _select_(opts, val, fn) {
      const s = h('select'); opts.forEach(([v, t]) => { const o = h('option', '', t); o.value = v; if (v == val) o.selected = true; s.appendChild(o); });
      s.onchange = () => fn(s.value); return s;
    }
    _rng(label, p, key, min, max, b, step = 1) {
      const l = h('label', 'ee-f'), sp = h('span', '', `${label}: <b>${p[key]}</b>`);
      l.append(sp, this._in('range', p[key], v => { p[key] = v; sp.lastChild.textContent = v; this._refresh(b); }, { min, max, step })); return l;
    }
    _color(label, p, key, b, clearable) {
      const l = h('label', 'ee-f'), row = h('div', 'ee-row');
      const i = this._in('color', p[key] || '#ffffff', v => { p[key] = v; this._refresh(b); });
      row.appendChild(i);
      if (clearable) { const x = h('button', 'ee-btn', 'None'); x.type = 'button'; x.onclick = e => { e.preventDefault(); p[key] = ''; this._refresh(b); }; row.appendChild(x); }
      l.appendChild(h('span', '', label)); l.appendChild(row); return l;
    }
    _alignSel(p, b) { return this._field('Alignment', this._select_([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], p.align, v => { p.align = v; this._refresh(b); })); }

    _renderProps() {
      const P = this.propsEl, b = this._get(this.sel); P.innerHTML = '';
      const add = (...n) => n.forEach(x => P.appendChild(x));
      if (!b) {
        const s = this.design.settings;
        add(h('h4', '', 'Email settings'), h('p', 'ee-note', 'Select a block on the canvas to edit it.'));
        const up = () => { this._renderCanvas(); this._changed(); };
        const w = h('label', 'ee-f'), sp = h('span', '', `Content width: <b>${s.width}</b>px`);
        w.append(sp, this._in('range', s.width, v => { s.width = v; sp.lastChild.textContent = v; up(); }, { min: 480, max: 720, step: 10 }));
        add(w,
          this._field('Content background', this._in('color', s.contentBg, v => { s.contentBg = v; up(); })),
          this._field('Page background', this._in('color', s.pageBg, v => { s.pageBg = v; up(); })),
          this._field('Font', this._select_(FONTS, s.font, v => { s.font = v; up(); })));
        return;
      }
      const p = b.props;
      add(h('h4', '', LABELS[b.type] + ' block'));
      if (b.type === 'text') {
        add(this._textTools(b), this._alignSel(p, b),
          this._rng('Font size', p, 'fontSize', 10, 40, b), this._rng('Line height', p, 'lineHeight', 1, 2.2, b, 0.1),
          this._rng('Padding', p, 'padding', 0, 64, b), this._color('Text color (whole block)', p, 'color', b), this._color('Background', p, 'bg', b, true));
      } else if (b.type === 'image') {
        const up = h('button', 'ee-btn', p.src ? 'Replace image' : 'Upload image'); up.onclick = () => this._pickImage(b.id);
        const rm = h('button', 'ee-btn', 'Remove'); rm.onclick = () => { p.src = ''; this._refresh(b); this._push(); this._renderProps(); };
        const row = h('div', 'ee-row'); row.style.marginBottom = '14px'; row.appendChild(up); if (p.src) row.appendChild(rm);
        add(row,
          this._field('Image URL', this._in('text', p.src.startsWith('data:') ? '' : p.src, v => { p.src = v.trim(); this._refresh(b); }, { placeholder: 'https://…' })),
          this._field('Alt text', this._in('text', p.alt, v => { p.alt = v; this._refresh(b); })),
          this._field('Link when clicked', this._in('url', p.link, v => { p.link = v.trim(); this._refresh(b); }, { placeholder: 'https://…' })),
          this._rng('Width (%)', p, 'width', 10, 100, b), this._alignSel(p, b), this._rng('Padding', p, 'padding', 0, 64, b));
      } else {
        const ta = h('textarea'); ta.value = p.code; ta.spellcheck = false;
        ta.addEventListener('input', () => { p.code = ta.value; this._refresh(b); });
        add(this._field('HTML code', ta), h('p', 'ee-note', this.opts.sanitize ? 'Scripts and event handlers are removed. Use inline styles and table layouts for best email-client support.' : 'Sanitizing is off. Your code is used as written.'));
      }
    }

    _textTools(b) {
      const t = h('div', 'ee-fmt');
      const mk = (label, title, fn, cls) => {
        const x = h('button', cls || '', label); x.title = title; x.type = 'button';
        x.onmousedown = e => e.preventDefault(); x.onclick = () => this._fmt(b, fn); t.appendChild(x); return x;
      };
      mk('<b>B</b>', 'Bold', () => ex('bold'));
      mk('<i>I</i>', 'Italic', () => ex('italic'));
      mk('<u>U</u>', 'Underline', () => ex('underline'));
      mk('Link', 'Add link', () => {
        const s = getSelection(), r = s.getRangeAt(0).cloneRange();
        const u = prompt('Link URL', 'https://'); if (!u) return;
        s.removeAllRanges(); s.addRange(r); ex('createLink', u);
      });
      mk('List', 'Bullet list', () => ex('insertUnorderedList'));
      mk('H1', 'Heading 1', () => ex('formatBlock', '<h1>'));
      mk('H2', 'Heading 2', () => ex('formatBlock', '<h2>'));
      mk('P', 'Paragraph', () => ex('formatBlock', '<p>'));
      mk('Clear', 'Clear formatting', () => ex('removeFormat'));
      SWATCHES.forEach(c => { const x = mk('', 'Text color ' + c, () => { ex('styleWithCSS', true); ex('foreColor', c); }, 'sw'); x.style.background = c; });
      return t;
    }
    _fmt(b, fn) {
      const body = this.canvas.querySelector(`[data-id="${b.id}"] .ee-body`), s = getSelection();
      if (!body || !s.rangeCount || !body.contains(s.anchorNode)) return this._toast('Click inside the text first, then select the words to format.');
      fn(); b.props.html = body.innerHTML; this._changed();
    }

    /* ---------- toolbar, modals ---------- */
    _bar(a) {
      const r = this.root;
      if (a === 'undo') return this.undo();
      if (a === 'redo') return this.redo();
      if (a === 'desktop' || a === 'mobile') {
        this.mobile = a === 'mobile';
        $('[data-act=desktop]', r).classList.toggle('is-on', !this.mobile); $('[data-act=mobile]', r).classList.toggle('is-on', this.mobile);
        return this._renderCanvas();
      }
      if (a === 'save') return this._download('email-design.json', JSON.stringify(this.getDesign(), null, 2), 'application/json');
      if (a === 'import') {
        const f = h('input'); f.type = 'file'; f.accept = '.json,application/json';
        f.onchange = () => { const fr = new FileReader(); fr.onload = () => { try { this.load(JSON.parse(fr.result)); } catch (e) { this._toast('That file is not a valid design JSON.'); } }; if (f.files[0]) fr.readAsText(f.files[0]); };
        return f.click();
      }
      const html = this.getHTML();
      if (a === 'export') {
        const ta = h('textarea', 'ee-code'); ta.readOnly = true; ta.value = html;
        const copy = h('button', 'ee-btn', 'Copy HTML');
        copy.onclick = async () => { try { await navigator.clipboard.writeText(html); } catch (e) { ta.select(); ex('copy'); } copy.textContent = 'Copied'; };
        const dl = h('button', 'ee-btn ee-primary', 'Download .html'); dl.onclick = () => this._download('email-template.html', html, 'text/html');
        this._modal('Export HTML', ta, [copy, dl]);
      } else if (a === 'preview') {
        const fr = h('iframe', 'ee-frame'); fr.srcdoc = html; fr.style.width = this.mobile ? '375px' : '100%';
        const d = h('button', 'ee-btn', 'Desktop'), m = h('button', 'ee-btn', 'Mobile');
        d.onclick = () => fr.style.width = '100%'; m.onclick = () => fr.style.width = '375px';
        this._modal('Preview', fr, [d, m]);
      }
    }
    _modal(title, body, foot) {
      const m = h('div', 'ee-modal', `<div class="ee-dlg"><div class="ee-dh"><strong>${title}</strong><button class="ee-x" aria-label="Close">&#10005;</button></div><div class="ee-dbody"></div><div class="ee-df"></div></div>`);
      $('.ee-dbody', m).appendChild(body); (foot || []).forEach(f => $('.ee-df', m).appendChild(f));
      m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('ee-x')) m.remove(); });
      this.root.appendChild(m);
    }
    _download(name, text, type) {
      const a = h('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    _toast(msg) { const t = h('div', 'ee-toast', esc(msg)); this.root.appendChild(t); setTimeout(() => t.remove(), 2600); }
  }

  global.EmailEditor = EmailEditor;
})(window);
