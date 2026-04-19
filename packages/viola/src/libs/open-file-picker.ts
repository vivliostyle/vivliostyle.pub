export interface FilePickerOptions {
  accept?: string;
  onFiles?: (files: File[]) => void | Promise<void>;
}

export function openFilePicker(opts: FilePickerOptions): Promise<File[]> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = opts.accept ?? '*/*';
  input.style.cssText = 'position:fixed;top:-9999px';
  document.body.appendChild(input);

  return new Promise((resolve) => {
    const cleanup = () => input.parentNode && document.body.removeChild(input);
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      opts.onFiles?.(files);
      resolve(files);
      cleanup();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      cleanup();
    });
    input.click();
  });
}
