/** Nhận diện dùng chung: vạch đỏ và ca-rô xuất phát. */
export function RedLineBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5">
      <span aria-hidden className="relative grid h-10 w-10 place-items-center overflow-hidden bg-primary text-white">
        <span className="headline text-2xl leading-none">R<span className="text-white/70">/</span></span>
        <span className="redline-checker absolute inset-x-0 bottom-0 h-1 text-black/50" />
      </span>
      {!compact && <span className="flex flex-col text-left">
        <span className="headline text-2xl leading-none tracking-wide">Red <span className="text-primary">Line</span></span>
        <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em]">Smash Team · Cầu lông</span>
      </span>}
    </span>
  );
}

/** Minh hoạ sân cầu lông và quả cầu bằng véc-tơ, không tải ảnh hay dữ liệu bên ngoài. */
export function StartingCourt() {
  return (
    <svg viewBox="0 0 640 520" fill="none" aria-hidden className="redline-court-art h-auto max-h-72 w-full lg:max-h-none">
      <defs>
        <linearGradient id="redline-court" x1="160" y1="160" x2="550" y2="480" gradientUnits="userSpaceOnUse">
          <stop stopColor="#353532" /><stop offset="1" stopColor="#111110" />
        </linearGradient>
        <linearGradient id="redline-feather" x1="300" y1="50" x2="500" y2="340" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset="1" stopColor="#9f9f96" />
        </linearGradient>
        <pattern id="redline-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" stroke="#fff" strokeOpacity=".07" />
        </pattern>
      </defs>
      <path fill="url(#redline-grid)" d="M0 0h640v520H0z" />
      <g transform="translate(20 270) rotate(-13 300 110)">
        <path d="M25 20H510L610 210H125Z" fill="url(#redline-court)" stroke="#75756c" />
        <path d="M48 38H500L578 190H130ZM80 38L160 190M470 38L550 190M276 38L356 190M88 115H538M185 38L265 190M367 38L447 190" stroke="#aaa99e" strokeWidth="1.5" />
        <path d="M83 106H534L543 123H92Z" fill="#dc2626" />
        <path d="M25 20H510" stroke="#dc2626" strokeWidth="4" />
      </g>
      <g transform="translate(330 30) rotate(22 90 150)">
        <path d="M74 258L5 30Q19 9 43 20L88 245ZM88 245L43 20Q62-1 86 16L103 247ZM103 247L86 16Q110-5 132 18L118 252ZM118 252L132 18Q154 10 171 32L131 259ZM131 259L171 32Q197 26 210 50L144 273Z" fill="url(#redline-feather)" stroke="#d6d6ca" strokeWidth="2" />
        <path d="M25 30L94 264M65 19L105 266M110 18L116 268M152 29L126 270M190 48L137 275M49 159L166 177M58 189L157 205M66 218L149 234" stroke="#79796f" strokeWidth="1.5" />
        <path d="M76 255L143 271L138 289L73 273Z" fill="#dc2626" />
        <path d="M73 273L138 289L131 311Q105 343 77 306Z" fill="#f5f4e9" stroke="#cfcec1" strokeWidth="2" />
        <path d="M78 290L135 303" stroke="#d6d5c9" strokeWidth="2" />
      </g>
      <path d="M70 180L253 127M42 209L243 151M102 226L263 181" stroke="#dc2626" strokeWidth="2" />
      <circle cx="253" cy="127" r="4" fill="#dc2626" />
      <path d="M82 462H182M82 475H142" stroke="#dc2626" strokeWidth="3" />
    </svg>
  );
}
