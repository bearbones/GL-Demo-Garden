export interface SliderDef {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export class ParamSlider {
  private container: HTMLDivElement;
  private values: Map<string, number> = new Map();

  constructor() {
    this.container = document.createElement('div');
    this.container.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:20',
      'background:rgba(0,0,0,0.7)',
      'backdrop-filter:blur(8px)',
      'border-radius:8px',
      'padding:12px 16px',
      'font-family:system-ui,sans-serif',
      'font-size:12px',
      'color:#ccc',
      'min-width:200px',
      'pointer-events:auto',
      'user-select:none',
    ].join(';');
    document.body.appendChild(this.container);
  }

  add(def: SliderDef): void {
    this.values.set(def.label, def.value);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

    const lbl = document.createElement('label');
    lbl.textContent = def.label;
    lbl.style.cssText = 'flex:0 0 90px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(def.value);
    input.style.cssText = 'flex:1;accent-color:#8af;height:4px;cursor:pointer;';

    const val = document.createElement('span');
    val.textContent = def.value.toFixed(3);
    val.style.cssText = 'flex:0 0 48px;text-align:left;font-variant-numeric:tabular-nums;';

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      this.values.set(def.label, v);
      val.textContent = v.toFixed(3);
    });

    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(val);
    this.container.appendChild(row);
  }

  get(label: string): number {
    return this.values.get(label) ?? 0;
  }

  destroy(): void {
    this.container.remove();
  }
}
