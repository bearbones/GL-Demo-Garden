export interface SliderConfig {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}

/** Shared demo controls. The gallery owns placement and visibility. */
export class ParamSlider {
  private static nextId = 0;
  private panel: HTMLDivElement;
  private sliders = new Map<string, { input: HTMLInputElement; update: (notify: boolean) => void }>();

  constructor() {
    this.panel = document.createElement('div');
    this.panel.className = 'param-panel';
    (document.getElementById('demo-controls') ?? document.body).appendChild(this.panel);
  }

  addSlider(config: SliderConfig): number {
    const row = document.createElement('label');
    row.className = 'param-slider';
    const label = document.createElement('span');
    label.textContent = config.label;
    const input = document.createElement('input');
    input.id = `garden-param-${++ParamSlider.nextId}`;
    // <output> is labelable too, so the range needs an explicit association.
    row.htmlFor = input.id;
    input.type = 'range';
    input.min = String(config.min);
    input.max = String(config.max);
    input.step = String(config.step ?? ((config.max - config.min) / 200));
    input.value = String(config.value);
    input.setAttribute('aria-label', config.label);
    // Decimal places must represent the whole step: 0.25 needs two, not one.
    const decimals = config.step === undefined ? 2
      : (config.step.toFixed(6).replace(/0+$/, '').split('.')[1]?.length ?? 0);
    const valueLabel = document.createElement('output');
    valueLabel.setAttribute('for', input.id);
    const update = (notify: boolean) => {
      const value = Number(input.value);
      valueLabel.value = value.toFixed(decimals);
      const fraction = config.max > config.min ? (value - config.min) / (config.max - config.min) : 0;
      input.style.setProperty('--range-fill', `${fraction * 100}%`);
      if (notify) config.onChange(value);
    };
    update(false);
    input.addEventListener('input', () => update(true));
    row.append(label, valueLabel, input);
    this.panel.appendChild(row);
    this.sliders.set(config.label, { input, update });
    return config.value;
  }

  addSelect(config: {
    label: string;
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  }): HTMLSelectElement {
    const row = document.createElement('label');
    row.className = 'param-select';
    const label = document.createElement('span');
    label.textContent = config.label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', config.label);
    for (const opt of config.options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    }
    select.value = config.value;
    select.addEventListener('change', () => config.onChange(select.value));
    row.append(label, select);
    this.panel.appendChild(row);
    return select;
  }

  addButtons(buttons: { label: string; onClick: () => void }[]) {
    const row = document.createElement('div');
    row.className = 'param-buttons';
    for (const config of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = config.label;
      button.addEventListener('click', config.onClick);
      row.appendChild(button);
    }
    this.panel.appendChild(row);
  }

  addSection(text: string) {
    const heading = document.createElement('h3');
    heading.className = 'param-section';
    heading.textContent = text;
    this.panel.appendChild(heading);
  }

  addNote(text: string) {
    const note = document.createElement('p');
    note.className = 'param-note';
    note.textContent = text;
    this.panel.appendChild(note);
  }

  setValue(label: string, value: number, notify = false) {
    const slider = this.sliders.get(label);
    if (!slider) return;
    slider.input.value = String(value);
    slider.update(notify);
  }

  setVisible(visible: boolean) {
    this.panel.hidden = !visible;
  }

  getValue(label: string): number {
    return Number(this.sliders.get(label)?.input.value ?? 0);
  }

  destroy() {
    this.panel.remove();
    this.sliders.clear();
  }
}
