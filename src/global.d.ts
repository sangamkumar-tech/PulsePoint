interface JsPdfInstance {
  internal: {
    pageSize: {
      getWidth(): number;
      getHeight(): number;
    };
  };
  addImage(
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;
  save(filename?: string): void;
}

interface Window {
  html2canvas?: (
    element: HTMLElement,
    options?: Record<string, unknown>
  ) => Promise<HTMLCanvasElement>;
  jspdf?: {
    jsPDF: new (options?: Record<string, unknown>) => JsPdfInstance;
  };
}
