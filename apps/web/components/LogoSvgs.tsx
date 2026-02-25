import React from "react";

function cn(...inputs: Array<string | number | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}

export type SvgProps = React.SVGProps<SVGSVGElement> & { color?: string; size?: number };

export const ZephIcon: React.FC<SvgProps> = ({ color = "#F5F5FA", className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className={className}>
    <rect width="64" height="64" rx="16" fill="#282554" />
    {/* stylized Z mark */}
    <path d="M21 45L36 19H23V16H43L28 42H41V45H21Z" fill={color} />
  </svg>
);

type Corner = "br" | "tr" | "tl" | "bl" | "mr" | "ml";

const DEFAULTS = {
  badgeScale: 1.7,
  minBaseScale2x: 0.9,
  corner: "br" as Corner,
  wrappedMainColor: "#627EEA",
  showChainBadge: false,
};

function baseScaleFor(badgeScale: number, minAtMax = DEFAULTS.minBaseScale2x, start = 1.5, end = 2) {
  const t = Math.max(0, Math.min(1, (badgeScale - start) / (end - start)));
  return 1 - (1 - minAtMax) * t;
}

function awayAxesSigns(corner: Corner): [number, number] {
  switch (corner) {
    case "br":
      return [-1, -1];
    case "tr":
      return [-1, 1];
    case "tl":
      return [1, 1];
    case "bl":
      return [1, -1];
    case "mr":
      return [-1, 0];
    case "ml":
      return [1, 0];
    default:
      return [-1, -1];
  }
}

function defaultTransformFor(corner: Corner = DEFAULTS.corner, badgeScale = DEFAULTS.badgeScale) {
  const bs = baseScaleFor(badgeScale);
  const shrinkPx = 48 * (1 - bs);
  const [sx, sy] = awayAxesSigns(corner);
  return { bs, shiftX: sx * shrinkPx, shiftY: sy * shrinkPx };
}

function ZephBase({
  color = "#282554",
  size = 96,
  children,
  baseScale = 1,
  shiftX = 0,
  shiftY = 0,
}: React.PropsWithChildren<SvgProps & { baseScale?: number; shiftX?: number; shiftY?: number }>) {
  const C = 48;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform={`translate(${shiftX} ${shiftY}) translate(${C} ${C}) scale(${baseScale}) translate(${-C} ${-C})`}>
        <circle cx="48" cy="48" r="48" fill={color} />
        <path
          d="M38 32H68L54.9 45.393H65.5L60.5 50.5048H49.9L41.7 58.8882H63L58 64H28L41.2 50.5048H30.5L35.5 45.393H46.2L54.3 37.1118H33L38 32Z"
          fill="#F5F5FA"
        />
      </g>
      {children}
    </svg>
  );
}

function ZephBadge({
  scale = DEFAULTS.badgeScale,
  r = 11.5,
  corner = DEFAULTS.corner,
  baseCx = 84,
  baseCy = 84,
  edgePad = 0.5,
  clipPad = 0.5,
  children,
}: {
  scale?: number;
  r?: number;
  corner?: Corner;
  baseCx?: number;
  baseCy?: number;
  edgePad?: number;
  clipPad?: number;
  children: React.ReactNode;
}) {
  const re = r * scale;

  const left = r + edgePad;
  const right = 96 - (r + edgePad);
  const top = r + edgePad;
  const bottom = 96 - (r + edgePad);

  let ax = right;
  let ay = bottom;
  switch (corner) {
    case "tr":
      ay = top;
      break;
    case "tl":
      ax = left;
      ay = top;
      break;
    case "bl":
      ax = left;
      break;
    case "mr":
      ay = 48;
      break;
    case "ml":
      ax = left;
      ay = 48;
      break;
  }

  const minC = re + clipPad;
  const maxC = 96 - re - clipPad;
  const cx = Math.max(minC, Math.min(maxC, ax));
  const cy = Math.max(minC, Math.min(maxC, ay));

  return <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-baseCx} ${-baseCy})`}>{children}</g>;
}

export const EthMiniBadge: React.FC<{ color?: string }> = ({ color = "#627EEA" }) => {
  return (
    <>
      <circle cx="84" cy="84" r="11.5" fill={color} stroke="#F5F5FA" />
      <path d="M84 78 L80 85 L84 82.8 L88 85 Z" fill="#F5F5FA" />
      <path d="M84 84.8 L80 86.5 L84 90 L88 86.5 Z" fill="#F5F5FA" opacity="0.9" />
    </>
  );
};

export const ZephLogo: React.FC<SvgProps> = ({ color = "#282554", size = 96 }) => (
  <ZephBase color={color} size={size} />
);

export const ZsdLogo: React.FC<SvgProps> = ({ color = "#282554", size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return (
    <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY}>
      <ZephBadge>
        <circle cx="84" cy="83.9998" r="11.5" fill="#31BB81" stroke="#F5F5FA" />
        <path
          d="M87.0796 83.2427C87.6332 83.3082 88.0946 83.425 88.4637 83.5932C88.842 83.7521 89.1419 83.9484 89.3633 84.182C89.594 84.4063 89.7555 84.6633 89.8478 84.953C89.9493 85.2427 90 85.5512 90 85.8783C90 86.2427 89.9308 86.5839 89.7924 86.9016C89.654 87.21 89.4418 87.4764 89.1557 87.7007C88.8697 87.925 88.5052 88.1026 88.0623 88.2334C87.6286 88.3642 87.1119 88.4297 86.5121 88.4297H85.4048L85.474 89.9998H83.3149L83.3841 88.4297H82.1107C81.0127 88.4297 80.1176 88.2661 79.4256 87.939C78.7336 87.6026 78.2584 87.1259 78 86.5091L79.9377 85.5418C80.1223 85.953 80.3945 86.2427 80.7543 86.411C81.1234 86.5792 81.5709 86.6633 82.0969 86.6633H86.4983C87.4394 86.6633 87.91 86.4016 87.91 85.8783C87.91 85.6259 87.8039 85.4437 87.5917 85.3315C87.3795 85.21 87.0657 85.1213 86.6505 85.0652L81.0865 84.6586C80.5606 84.6026 80.1176 84.4951 79.7578 84.3362C79.4072 84.1773 79.1211 83.9857 78.8997 83.7614C78.6874 83.5278 78.5352 83.2708 78.4429 82.9904C78.3506 82.71 78.3045 82.4203 78.3045 82.1213C78.3045 81.7568 78.3737 81.4203 78.5121 81.1119C78.6597 80.7941 78.8812 80.5231 79.1765 80.2988C79.481 80.0745 79.8593 79.9016 80.3114 79.7801C80.7728 79.6493 81.3172 79.5839 81.9446 79.5839H83.3702L83.301 77.9998H85.4602L85.391 79.5839H86.1661C87.1442 79.5839 87.9377 79.7194 88.5467 79.9904C89.1649 80.2614 89.6078 80.6493 89.8754 81.154L88.173 82.2054C87.9792 81.9156 87.7255 81.7007 87.4118 81.5605C87.098 81.4203 86.6782 81.3502 86.1522 81.3502H81.9308C81.4048 81.3502 81.0173 81.4156 80.7682 81.5465C80.519 81.668 80.3945 81.8502 80.3945 82.0932C80.3945 82.3082 80.4913 82.4764 80.6851 82.5979C80.8789 82.7194 81.2111 82.8175 81.6817 82.8923L87.0796 83.2427Z"
          fill="#F5F5FA"
        />
      </ZephBadge>
    </ZephBase>
  );
};

export const ZrsLogo: React.FC<SvgProps> = ({ color = "#282554", size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return (
    <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY}>
      <ZephBadge>
        <circle cx="84" cy="84" r="11.5" fill="#EB4634" stroke="#F5F5FA" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M87.6744 89H90L87.8206 85.5896C88.5116 85.3198 89.0078 84.92 89.309 84.3902C89.619 83.8507 89.7741 83.2197 89.7741 82.4971V82.4827C89.7741 81.9721 89.6988 81.5048 89.5482 81.0809C89.4064 80.657 89.1761 80.2909 88.8571 79.9827C88.5382 79.6744 88.1262 79.4335 87.6213 79.2601C87.1163 79.0867 86.5094 79 85.8007 79H78V81.0087H80.0598H85.8007C86.4563 81.0087 86.9347 81.1291 87.2359 81.3699C87.546 81.6108 87.701 81.9817 87.701 82.4827V82.4971C87.701 83.0077 87.546 83.3834 87.2359 83.6243C86.9347 83.8651 86.4563 83.9855 85.8007 83.9855H80.0598H78V89H80.0598V85.9075H85.814L87.6744 89Z"
          fill="#F5F5FA"
        />
      </ZephBadge>
    </ZephBase>
  );
};

export const ZysLogo: React.FC<SvgProps> = ({ color = "#282554", size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return (
    <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY}>
      <ZephBadge>
        <circle cx="84" cy="84" r="11.5" fill="#349EEB" stroke="#F5F5FA" />
        <path
          d="M84 84.5607L87.816 81H91L85.2044 86.3179V89H82.7956V86.3179L77 81H80.1721L84 84.5607Z"
          fill="#F5F5FA"
        />
      </ZephBadge>
    </ZephBase>
  );
};

export const WZephLogo: React.FC<SvgProps> = ({ color = DEFAULTS.wrappedMainColor, size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY} />;
};

export const WZsdLogo: React.FC<SvgProps> = ({ color = DEFAULTS.wrappedMainColor, size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return (
    <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY}>
      <ZephBadge>
        <circle cx="84" cy="83.9998" r="11.5" fill="#31BB81" stroke="#F5F5FA" />
        <path
          d="M87.0796 83.2427C87.6332 83.3082 88.0946 83.425 88.4637 83.5932C88.842 83.7521 89.1419 83.9484 89.3633 84.182C89.594 84.4063 89.7555 84.6633 89.8478 84.953C89.9493 85.2427 90 85.5512 90 85.8783C90 86.2427 89.9308 86.5839 89.7924 86.9016C89.654 87.21 89.4418 87.4764 89.1557 87.7007C88.8697 87.925 88.5052 88.1026 88.0623 88.2334C87.6286 88.3642 87.1119 88.4297 86.5121 88.4297H85.4048L85.474 89.9998H83.3149L83.3841 88.4297H82.1107C81.0127 88.4297 80.1176 88.2661 79.4256 87.939C78.7336 87.6026 78.2584 87.1259 78 86.5091L79.9377 85.5418C80.1223 85.953 80.3945 86.2427 80.7543 86.411C81.1234 86.5792 81.5709 86.6633 82.0969 86.6633H86.4983C87.4394 86.6633 87.91 86.4016 87.91 85.8783C87.91 85.6259 87.8039 85.4437 87.5917 85.3315C87.3795 85.21 87.0657 85.1213 86.6505 85.0652L81.0865 84.6586C80.5606 84.6026 80.1176 84.4951 79.7578 84.3362C79.4072 84.1773 79.1211 83.9857 78.8997 83.7614C78.6874 83.5278 78.5352 83.2708 78.4429 82.9904C78.3506 82.71 78.3045 82.4203 78.3045 82.1213C78.3045 81.7568 78.3737 81.4203 78.5121 81.1119C78.6597 80.7941 78.8812 80.5231 79.1765 80.2988C79.481 80.0745 79.8593 79.9016 80.3114 79.7801C80.7728 79.6493 81.3172 79.5839 81.9446 79.5839H83.3702L83.301 77.9998H85.4602L85.391 79.5839H86.1661C87.1442 79.5839 87.9377 79.7194 88.5467 79.9904C89.1649 80.2614 89.6078 80.6493 89.8754 81.154L88.173 82.2054C87.9792 81.9156 87.7255 81.7007 87.4118 81.5605C87.098 81.4203 86.6782 81.3502 86.1522 81.3502H81.9308C81.4048 81.3502 81.0173 81.4156 80.7682 81.5465C80.519 81.668 80.3945 81.8502 80.3945 82.0932C80.3945 82.3082 80.4913 82.4764 80.6851 82.5979C80.8789 82.7194 81.2111 82.8175 81.6817 82.8923L87.0796 83.2427Z"
          fill="#F5F5FA"
        />
      </ZephBadge>
      {DEFAULTS.showChainBadge && (
        <ZephBadge corner="tr">
          <EthMiniBadge />
        </ZephBadge>
      )}
    </ZephBase>
  );
};

export const WZrsLogo: React.FC<SvgProps> = ({ color = DEFAULTS.wrappedMainColor, size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return (
    <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY}>
      <ZephBadge>
        <circle cx="84" cy="84" r="11.5" fill="#EB4634" stroke="#F5F5FA" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M87.6744 89H90L87.8206 85.5896C88.5116 85.3198 89.0078 84.92 89.309 84.3902C89.619 83.8507 89.7741 83.2197 89.7741 82.4971V82.4827C89.7741 81.9721 89.6988 81.5048 89.5482 81.0809C89.4064 80.657 89.1761 80.2909 88.8571 79.9827C88.5382 79.6744 88.1262 79.4335 87.6213 79.2601C87.1163 79.0867 86.5094 79 85.8007 79H78V81.0087H80.0598H85.8007C86.4563 81.0087 86.9347 81.1291 87.2359 81.3699C87.546 81.6108 87.701 81.9817 87.701 82.4827V82.4971C87.701 83.0077 87.546 83.3834 87.2359 83.6243C86.9347 83.8651 86.4563 83.9855 85.8007 83.9855H80.0598H78V89H80.0598V85.9075H85.814L87.6744 89Z"
          fill="#F5F5FA"
        />
      </ZephBadge>
      {DEFAULTS.showChainBadge && (
        <ZephBadge corner="tr">
          <EthMiniBadge />
        </ZephBadge>
      )}
    </ZephBase>
  );
};

export const WZysLogo: React.FC<SvgProps> = ({ color = DEFAULTS.wrappedMainColor, size = 96 }) => {
  const { bs, shiftX, shiftY } = defaultTransformFor();
  return (
    <ZephBase color={color} size={size} baseScale={bs} shiftX={shiftX} shiftY={shiftY}>
      <ZephBadge>
        <circle cx="84" cy="84" r="11.5" fill="#349EEB" stroke="#F5F5FA" />
        <path
          d="M84 84.5607L87.816 81H91L85.2044 86.3179V89H82.7956V86.3179L77 81H80.1721L84 84.5607Z"
          fill="#F5F5FA"
        />
      </ZephBadge>
      {DEFAULTS.showChainBadge && (
        <ZephBadge corner="tr">
          <EthMiniBadge />
        </ZephBadge>
      )}
    </ZephBase>
  );
};

// Simple token circle logos for ETH/USDT/USDC
export const EthLogo: React.FC<SvgProps> = ({ color = "#627EEA", size = 24 }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill={color} />
      <g transform="translate(6,4)" fill="#fff">
        <path d="M6 0L0 10L6 7.2L12 10L6 0Z" />
        <path d="M6 8L0 11.2L6 16L12 11.2L6 8Z" opacity="0.9" />
      </g>
    </svg>
  );
};

export const UsdtLogo: React.FC<SvgProps> = ({ color = "#50AF95", size = 24 }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill={color} />
      <g fill="#fff">
        <rect x="5" y="7" width="14" height="2" rx="1" />
        <rect x="11" y="9" width="2" height="8" rx="1" />
        <path d="M6 11c0 1.657 2.686 3 6 3s6-1.343 6-3-2.686-3-6-3-6 1.343-6 3Zm2 0c0-.552 1.79-1 4-1s4 .448 4 1-1.79 1-4 1-4-.448-4-1Z" />
      </g>
    </svg>
  );
};

export const UsdcLogo: React.FC<SvgProps> = ({ color = "#2775CA", size = 24 }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill={color} />
      <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7.2 6.6A7 7 0 0 0 6 12a7 7 0 0 0 1.2 5.4" />
        <path d="M16.8 17.4A7 7 0 0 0 18 12a7 7 0 0 0-1.2-5.4" />
        <path d="M12 7.5c-1.5 0-2.5.9-2.5 2 0 2 5 1 5 3 0 1.1-1 2-2.5 2" />
        <path d="M12 7.5V6.2M12 17.8v-1.3" />
      </g>
    </svg>
  );
};

export const YieldReserve: React.FC<SvgProps> = ({ color = "#F5F5FA", size = 96 }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="48" cy="48" r="48" fill="#F5F5FA" />
      <g clipPath="url(#clip0_25_1628)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M48.0011 49.7197L47.2646 48.9204L34.4372 35H26.3025L44.6012 54.589L44.8705 54.8773V55.2717V67H51.1294V55.2717V54.8773L51.3987 54.589L69.6974 35H61.5227L48.7364 48.9193L48.0011 49.7197ZM37.9999 35L47.9999 46L57.9999 35H37.9999Z"
          fill="#282554"
        />
      </g>
      <defs>
        <clipPath id="clip0_25_1628">
          <rect width="44" height="32" fill="white" transform="translate(26 35)" />
        </clipPath>
      </defs>
    </svg>
  );
};

export const Reserve: React.FC<SvgProps> = ({ color = "#F5F5FA", size = 96 }) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 96 96" fill="none">
      <circle cx="48" cy="48" r="48" fill={color} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M67 64H59.6357L53.7442 54.104H35.5227V64H29V47.9539H35.5227H53.7021C55.7781 47.9539 57.2931 47.5684 58.2469 46.7976C59.2289 46.0269 59.7198 44.8247 59.7198 43.1907V43.1445C59.7198 41.5415 59.2289 40.3545 58.2469 39.5837C57.2931 38.813 55.7781 38.4277 53.7021 38.4277H35.5227H29V32H53.7021C55.9465 32 57.8682 32.2773 59.4673 32.8323C61.0664 33.3872 62.371 34.158 63.381 35.1445C64.3909 36.1311 65.1203 37.3025 65.5692 38.6589C66.0461 40.0154 66.2846 41.5105 66.2846 43.1445V43.1907C66.2846 45.5029 65.7936 47.5222 64.8117 49.2485C63.8579 50.9441 62.2868 52.2234 60.0986 53.0867L67 64ZM54.9762 41.0305H29V45.4849H54.9762C56.2062 45.4849 57.2034 44.4878 57.2034 43.2578C57.2034 42.0276 56.2062 41.0305 54.9762 41.0305Z"
        fill="#282554"
      />
    </svg>
  );
};

export const ZephyrCircle: React.FC<SvgProps> = ({ color = "#F5F5FA" }) => {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="36" cy="36" r="35.5" fill={color} stroke="#F5F5FA" />
      <g clipPath="url(#clip0_117_479)">
        <path
          d="M30 26H48L40.14 34.3706H46.5L43.5 37.5655H37.14L32.22 42.8051H45L42 46H24L31.92 37.5655H25.5L28.5 34.3706H34.92L39.78 29.1949H27L30 26Z"
          fill="#F5F5FA"
        />
      </g>
      <defs>
        <clipPath id="clip0_117_479">
          <rect width="24" height="20" fill="white" transform="translate(24 26)" />
        </clipPath>
      </defs>
    </svg>
  );
};

export const ZsdCircle: React.FC<SvgProps> = ({ color = "#F5F5FA" }) => {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill={color} xmlns="http://www.w3.org/2000/svg">
      <circle cx="36" cy="36" r="35.5" fill={color} stroke="#F5F5FA" />
      <circle cx="57.9999" cy="59.9998" r="11.5" fill="#31BB81" stroke="#F5F5FA" />
      <path
        d="M61.0795 59.2428C61.6331 59.3082 62.0945 59.425 62.4635 59.5932C62.8419 59.7521 63.1417 59.9484 63.3632 60.182C63.5939 60.4063 63.7554 60.6633 63.8476 60.9531C63.9491 61.2428 63.9999 61.5512 63.9999 61.8783C63.9999 62.2428 63.9307 62.5839 63.7923 62.9017C63.6539 63.2101 63.4416 63.4764 63.1556 63.7007C62.8695 63.925 62.5051 64.1026 62.0622 64.2334C61.6285 64.3643 61.1118 64.4297 60.512 64.4297H59.4047L59.4739 65.9998H57.3148L57.384 64.4297H56.1106C55.0126 64.4297 54.1175 64.2661 53.4255 63.939C52.7334 63.6026 52.2582 63.126 51.9999 62.5091L53.9376 61.5418C54.1221 61.9531 54.3943 62.2428 54.7542 62.411C55.1233 62.5792 55.5708 62.6633 56.0968 62.6633H60.4981C61.4393 62.6633 61.9099 62.4017 61.9099 61.8783C61.9099 61.626 61.8038 61.4437 61.5916 61.3316C61.3793 61.2101 61.0656 61.1213 60.6504 61.0652L55.0864 60.6587C54.5604 60.6026 54.1175 60.4951 53.7577 60.3362C53.407 60.1774 53.121 59.9858 52.8995 59.7615C52.6873 59.5278 52.5351 59.2708 52.4428 58.9904C52.3505 58.7101 52.3044 58.4203 52.3044 58.1213C52.3044 57.7568 52.3736 57.4203 52.512 57.1119C52.6596 56.7942 52.8811 56.5232 53.1763 56.2989C53.4808 56.0746 53.8592 55.9017 54.3113 55.7802C54.7727 55.6493 55.3171 55.5839 55.9445 55.5839H57.3701L57.3009 53.9998H59.4601L59.3909 55.5839H60.166C61.1441 55.5839 61.9376 55.7194 62.5466 55.9904C63.1648 56.2615 63.6077 56.6493 63.8753 57.154L62.1729 58.2054C61.9791 57.9157 61.7254 57.7007 61.4116 57.5605C61.0979 57.4203 60.6781 57.3503 60.1521 57.3503H55.9307C55.4047 57.3503 55.0172 57.4157 54.768 57.5465C54.5189 57.668 54.3943 57.8503 54.3943 58.0932C54.3943 58.3082 54.4912 58.4764 54.685 58.5979C54.8788 58.7194 55.211 58.8175 55.6815 58.8923L61.0795 59.2428Z"
        fill="#F5F5FA"
      />
      <g clipPath="url(#clip0_117_471)">
        <path
          d="M30 26H48L40.14 34.3706H46.5L43.5 37.5655H37.14L32.22 42.8051H45L42 46H24L31.92 37.5655H25.5L28.5 34.3706H34.92L39.78 29.1949H27L30 26Z"
          fill="#F5F5FA"
        />
      </g>
      <defs>
        <clipPath id="clip0_117_471">
          <rect width="24" height="20" fill="white" transform="translate(24 26)" />
        </clipPath>
      </defs>
    </svg>
  );
};
