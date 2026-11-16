/**
 * "Screenshot" label for an imported image. Three signals, all about the file and none about what is in the picture:
 *   - the file name is one a phone or computer gives a screenshot ("Screenshot 2026-03-03 at 10.12.04", "Screenshot_2026...")
 *   - the file carries no camera make or model, and
 *   - its pixel size is one of the common screens (phones, tablets, laptops), in either orientation.
 * The label is set when the name matches, or when there is no camera data AND the size matches a screen. It is a hint that
 * lets the app say "keep the original messages on your phone too"; it says nothing about what the image shows.
 */
export interface ScreenshotInput {
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
  hasCameraData: boolean;
}

export interface ScreenshotResult {
  likely: boolean;
  reasons: Array<'file-name' | 'screen-size-no-camera'>;
}

const NAME = /screen[\s_-]?shot|screen[\s_-]?capture|screen[\s_-]?grab|bildschirmfoto|captura de pantalla|capture d.[eé]cran|schermafbeelding|simulator screen/i;

/** width x height of common screens, portrait; matched in either orientation. */
const SCREENS: Array<[number, number]> = [
  // iPhone
  [640, 1136], [750, 1334], [828, 1792], [1080, 1920], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622], [1242, 2208],
  [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868],
  // Android
  [720, 1280], [720, 1520], [720, 1600], [1080, 2160], [1080, 2220], [1080, 2280], [1080, 2310], [1080, 2340], [1080, 2400],
  [1080, 2408], [1080, 2412], [1344, 2992], [1440, 2560], [1440, 2960], [1440, 3040], [1440, 3088], [1440, 3120], [1440, 3200],
  // tablets
  [1536, 2048], [1620, 2160], [1640, 2360], [1668, 2224], [1668, 2388], [2048, 2732], [1600, 2560], [1200, 1920],
  // laptops and desktops
  [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080], [1920, 1200],
  [2048, 1152], [2560, 1440], [2560, 1600], [2880, 1800], [2940, 1912], [3024, 1964], [3440, 1440], [3456, 2234], [3840, 2160],
];
const SCREEN_KEYS = new Set(SCREENS.flatMap(([a, b]) => [`${a}x${b}`, `${b}x${a}`]));

export function isScreenSize(width?: number, height?: number): boolean {
  return !!width && !!height && SCREEN_KEYS.has(`${width}x${height}`);
}

export function screenshotSignals(i: ScreenshotInput): ScreenshotResult {
  const reasons: ScreenshotResult['reasons'] = [];
  const image = i.mimeType.toLowerCase().startsWith('image/');
  if (!image) return { likely: false, reasons };
  if (NAME.test(i.fileName)) reasons.push('file-name');
  if (!i.hasCameraData && isScreenSize(i.width, i.height)) reasons.push('screen-size-no-camera');
  return { likely: reasons.length > 0, reasons };
}
