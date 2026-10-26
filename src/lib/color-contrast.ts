/** WCAG foreground for the app's opaque hex category and HSL avatar swatches. */
export function contrastTextColor(background: string): '#000000' | '#ffffff' {
  const hsl = /^hsl\(\s*([\d.-]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/.exec(
    background,
  );
  let channels: number[];
  if (hsl) {
    const hue = ((Number(hsl[1]) % 360) + 360) % 360;
    const saturation = Number(hsl[2]) / 100;
    const lightness = Number(hsl[3]) / 100;
    const amplitude = saturation * Math.min(lightness, 1 - lightness);
    channels = [0, 8, 4].map((offset) => {
      const position = (offset + hue / 30) % 12;
      return (
        lightness -
        amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1))
      );
    });
  } else {
    const hex = background.replace('#', '');
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex;
    channels = [0, 2, 4].map(
      (index) => parseInt(full.slice(index, index + 2), 16) / 255,
    );
  }
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  // Choosing the stronger of black/white guarantees >=4.5:1 for an opaque sRGB fill.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05
    ? '#ffffff'
    : '#000000';
}
