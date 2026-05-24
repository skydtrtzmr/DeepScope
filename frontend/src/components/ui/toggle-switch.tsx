interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  label?: string;
}

export function ToggleSwitch({ checked, onCheckedChange, id, label }: ToggleSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`
        relative inline-flex h-5 w-9 items-center rounded-full transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        ${checked ? 'bg-primary' : 'bg-input'}
      `}
    >
      <span
        className={`
          inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform
          ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}
        `}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}
