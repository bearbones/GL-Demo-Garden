export interface SliderConfig {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}

export class ParamSlider {
  private panel: HTMLDivElement;
  private sliders: Map<string, HTMLInputElement> = new Map();

  constructor() {
    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:20',
      'background:rgba(0,0,0,0.7)',
      'backdrop-filter:blur(8px)',
      'border-radius:10px',
      'padding:12px 16px',
      'font-family:system-ui,sans-serif',
      'font-size:12px',
      'color:#eee',
      'min-width:200px',
      'user-select:none',
    ].join(';');
    document.body.appendChild(this.panel);
  }

  addSlider(config: SliderConfig): number {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';

    const label = document.createElement('span');
    label.textContent = config.label;
    label.style.cssText = 'flex:0 0 90px;text-align:right;opacity:0.8;';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(config.min);
    input.max = String(config.max);
    input.step = String(config.step ?? ((config.max - config.min) / 200));
    input.value = String(config.value);
    input.style.cssText = 'flex:1;accent-color:#8af;height:4px;cursor:pointer;';

    const valueLabel = document.createElement('span');
    valueLabel.textContent = config.value.toFixed(2);
    valueLabel.style.cssText = 'flex:0 0 42px;text-align:left;font-variant-numeric:tabular-nums;opacity:0.6;';

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valueLabel.textContent = v.toFixed(2);
      config.onChange(v);
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(valueLabel);
    this.panel.appendChild(row);
    this.sliders.set(config.label, input);

    return config.value;
  }

  getValue(label: string): number {
    const input = this.sliders.get(label);
    return input ? parseFloat(input.value) : 0;
  }

  destroy() {
    this.panel.remove();
    this.sliders.clear();
  }
}
