import { fireEvent } from '@testing-library/react';
/** jsdom does not fetch/decode images; tests explicitly deliver the browser load result. */
export function finishPreview(image: HTMLElement) {
  Object.defineProperties(image, { complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 850 }, naturalHeight: { configurable: true, value: 1100 } });
  fireEvent.load(image);
  return image;
}
