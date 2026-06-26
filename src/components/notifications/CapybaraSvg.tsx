export function CapybaraSvg({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <style>{`
        @keyframes capy-blink {
          0%, 90%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        @keyframes capy-ear-l {
          0%, 85%, 100% { transform: rotate(0deg); transform-origin: 22px 20px; }
          90% { transform: rotate(-8deg); transform-origin: 22px 20px; }
        }
        @keyframes capy-ear-r {
          0%, 85%, 100% { transform: rotate(0deg); transform-origin: 58px 20px; }
          90% { transform: rotate(8deg); transform-origin: 58px 20px; }
        }
        .capy-eye { animation: capy-blink 3.2s ease-in-out infinite; transform-origin: center; }
        .capy-ear-l { animation: capy-ear-l 3.2s ease-in-out infinite; }
        .capy-ear-r { animation: capy-ear-r 3.2s ease-in-out infinite; }
      `}</style>

      {/* Ears */}
      <ellipse className="capy-ear-l" cx="22" cy="20" rx="9" ry="7" fill="#7B5B14" />
      <ellipse cx="22" cy="20" rx="5" ry="3.5" fill="#C4874A" />
      <ellipse className="capy-ear-r" cx="58" cy="20" rx="9" ry="7" fill="#7B5B14" />
      <ellipse cx="58" cy="20" rx="5" ry="3.5" fill="#C4874A" />

      {/* Body/head base — wide rectangular capybara shape */}
      <rect x="8" y="26" width="64" height="42" rx="16" fill="#9A6F2A" />

      {/* Face highlight */}
      <rect x="14" y="30" width="52" height="34" rx="12" fill="#B8852F" />

      {/* Snout — prominent and flat */}
      <rect x="18" y="46" width="44" height="20" rx="10" fill="#D4A050" />

      {/* Eyes */}
      <g className="capy-eye">
        <circle cx="31" cy="40" r="4.5" fill="#1A0F00" />
        <circle cx="49" cy="40" r="4.5" fill="#1A0F00" />
        {/* Eye shine */}
        <circle cx="33" cy="38" r="1.5" fill="white" />
        <circle cx="51" cy="38" r="1.5" fill="white" />
      </g>

      {/* Nostrils */}
      <ellipse cx="34" cy="56" rx="4" ry="3" fill="#6B3D0A" />
      <ellipse cx="46" cy="56" rx="4" ry="3" fill="#6B3D0A" />

      {/* Mouth — chill smile */}
      <path d="M 32 62 Q 40 67 48 62" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  )
}
