(() => {
  class ExerciseControls extends HTMLElement {
    constructor() {
      super();
      this.playing = false;
      this.busy = false;
    }

    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host {
            display:block;
            --exercise-control-radius:4px;
          }
          *, *::before, *::after { box-sizing:border-box; }
          .controls {
            display:grid;
            grid-template-columns:48px 72px;
            grid-template-rows:22px 22px;
            gap:4px 8px;
            align-items:stretch;
            width:max-content;
          }
          button {
            display:inline-flex;
            align-items:center;
            justify-content:center;
            width:100%;
            height:100%;
            border:none;
            border-radius:var(--exercise-control-radius);
            padding:0;
            font:700 15px/1.2 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;
            cursor:pointer;
            color:var(--exercise-control-primary-fg,#101114);
            background:var(--exercise-control-primary,var(--accent,#f2c35b));
          }
          button:disabled { cursor:wait; opacity:.68; }
          button.secondary {
            grid-column:2;
            color:var(--exercise-control-secondary-fg,#edf0f5);
            background:var(--exercise-control-secondary,#252d3a);
          }
          button.toggle {
            grid-row:1 / 3;
          }
          button.toggle svg {
            width:22px;
            height:22px;
          }
          svg { width:14px; height:14px; stroke-width:2.4; }
          input {
            grid-column:2;
            width:100%;
            min-width:0;
            border:1px solid var(--exercise-control-input-border,#303849);
            border-radius:var(--exercise-control-radius);
            padding:3px 8px;
            outline:none;
            color:var(--exercise-control-input-fg,#edf0f5);
            background:var(--exercise-control-input-bg,#0d1118);
            font:12px/1.2 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;
          }
          input:focus { border-color:var(--exercise-control-focus,var(--accent2,#7dd6c8)); }
          @media (max-width:440px) {
            .controls { grid-template-columns:48px 72px; }
          }
        </style>
        <div class="controls">
          <button type="button" class="toggle" data-action="toggle"></button>
          <input type="text" placeholder="种子" autocomplete="off" />
          <button type="button" class="secondary" data-action="regenerate" title="换一版" aria-label="换一版">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 15.2-6.5"></path>
              <path d="M18 2v4h-4"></path>
              <path d="M21 12a9 9 0 0 1-15.2 6.5"></path>
              <path d="M6 22v-4h4"></path>
            </svg>
          </button>
        </div>
      `;
      root.querySelector('[data-action="toggle"]').addEventListener('click', () => {
        if (this.busy) return;
        this.emit(this.playing ? 'stop' : 'play');
      });
      root.querySelector('[data-action="regenerate"]').addEventListener('click', () => this.emit('regenerate'));
      const input = root.querySelector('input');
      input.setAttribute('aria-label', '演出种子');
      if (this.hasAttribute('apply-seed')) {
        input.title = '输入种子后按 Enter 应用';
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || event.isComposing || this.busy) return;
          event.preventDefault();
          this.emit('seed-apply');
        });
      }
      this.renderToggle();
    }

    emit(action) {
      this.dispatchEvent(new CustomEvent('exercise-' + action, { bubbles: true }));
    }

    get seedValue() {
      const input = this.shadowRoot && this.shadowRoot.querySelector('input');
      return input ? input.value.trim() : '';
    }

    clearSeed() {
      const input = this.shadowRoot && this.shadowRoot.querySelector('input');
      if (input) input.value = '';
    }

    setPlaying(playing) {
      this.playing = Boolean(playing);
      this.renderToggle();
    }

    setBusy(busy) {
      this.busy = Boolean(busy);
      this.renderToggle();
    }

    renderToggle() {
      if (!this.shadowRoot) return;
      const button = this.shadowRoot.querySelector('[data-action="toggle"]');
      const regenerate = this.shadowRoot.querySelector('[data-action="regenerate"]');
      if (!button) return;
      button.disabled = this.busy;
      if (this.hasAttribute('apply-seed')) this.shadowRoot.querySelector('input').disabled = this.busy;
      if (regenerate) regenerate.disabled = this.busy;
      button.title = this.playing ? '停止' : '播放';
      button.setAttribute('aria-label', this.playing ? '停止' : '播放');
      button.innerHTML = this.playing
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`;
    }
  }

  customElements.define('exercise-controls', ExerciseControls);
})();
