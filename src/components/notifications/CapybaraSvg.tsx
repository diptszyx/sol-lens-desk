import type { PetEmotion } from '../../store/pet'

interface Props {
  size?: number
  emotion?: PetEmotion
}

function Eyes({ emotion }: { emotion: PetEmotion }) {
  switch (emotion) {
    case 'alert':
      return (
        <g>
          <circle cx="31" cy="38" r="5.5" fill="#1A0F00" />
          <circle cx="49" cy="38" r="5.5" fill="#1A0F00" />
          <circle cx="33" cy="36" r="2" fill="white" />
          <circle cx="51" cy="36" r="2" fill="white" />
        </g>
      )
    case 'pumping':
      // star eyes — circle + 4 small triangles
      return (
        <g>
          <circle cx="31" cy="40" r="5" fill="#FFD700" />
          <circle cx="49" cy="40" r="5" fill="#FFD700" />
          <circle cx="31" cy="40" r="2.5" fill="#1A0F00" />
          <circle cx="49" cy="40" r="2.5" fill="#1A0F00" />
          <circle cx="32.5" cy="38.5" r="1.2" fill="white" />
          <circle cx="50.5" cy="38.5" r="1.2" fill="white" />
        </g>
      )
    case 'watching':
      // worried — angled inward at top
      return (
        <g>
          <ellipse cx="31" cy="40" rx="4.5" ry="4" fill="#1A0F00" />
          <ellipse cx="49" cy="40" rx="4.5" ry="4" fill="#1A0F00" />
          <circle cx="33" cy="38.5" r="1.5" fill="white" />
          <circle cx="51" cy="38.5" r="1.5" fill="white" />
          {/* worried brow lines */}
          <line x1="27" y1="34" x2="34" y2="36" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" />
          <line x1="53" y1="36" x2="46" y2="34" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" />
        </g>
      )
    case 'shrug':
      // half-closed, tired
      return (
        <g>
          <ellipse cx="31" cy="41" rx="4.5" ry="3" fill="#1A0F00" />
          <ellipse cx="49" cy="41" rx="4.5" ry="3" fill="#1A0F00" />
          <circle cx="33" cy="40" r="1.2" fill="white" />
          <circle cx="51" cy="40" r="1.2" fill="white" />
          {/* droopy eyelids */}
          <path d="M 26.5 39 Q 31 36 35.5 39" fill="#B8852F" />
          <path d="M 44.5 39 Q 49 36 53.5 39" fill="#B8852F" />
        </g>
      )
    case 'celebration':
      return (
        <g>
          <circle cx="31" cy="39" r="5.5" fill="#1A0F00" />
          <circle cx="49" cy="39" r="5.5" fill="#1A0F00" />
          <circle cx="33" cy="37" r="2.2" fill="white" />
          <circle cx="51" cy="37" r="2.2" fill="white" />
          {/* sparkle dots */}
          <circle cx="20" cy="32" r="1.5" fill="#FFD700" />
          <circle cx="60" cy="32" r="1.5" fill="#FFD700" />
          <circle cx="16" cy="38" r="1" fill="#FFD700" />
          <circle cx="64" cy="38" r="1" fill="#FFD700" />
        </g>
      )
    case 'invested':
      // focused squint
      return (
        <g>
          <ellipse cx="31" cy="41" rx="4.5" ry="3.5" fill="#1A0F00" />
          <ellipse cx="49" cy="41" rx="4.5" ry="3.5" fill="#1A0F00" />
          <circle cx="33" cy="40" r="1.5" fill="white" />
          <circle cx="51" cy="40" r="1.5" fill="white" />
        </g>
      )
    default: // idle
      return (
        <g className="capy-eye">
          <circle cx="31" cy="40" r="4.5" fill="#1A0F00" />
          <circle cx="49" cy="40" r="4.5" fill="#1A0F00" />
          <circle cx="33" cy="38" r="1.5" fill="white" />
          <circle cx="51" cy="38" r="1.5" fill="white" />
        </g>
      )
  }
}

function Mouth({ emotion }: { emotion: PetEmotion }) {
  switch (emotion) {
    case 'alert':
      return <ellipse cx="40" cy="62" rx="5" ry="3" fill="#6B3D0A" />
    case 'pumping':
      return <path d="M 28 60 Q 40 70 52 60" stroke="#6B3D0A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    case 'watching':
      return <path d="M 32 64 Q 40 60 48 64" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" fill="none" />
    case 'shrug':
      return <path d="M 33 63 L 47 63" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" fill="none" />
    case 'celebration':
      return (
        <g>
          <path d="M 26 59 Q 40 72 54 59" stroke="#6B3D0A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <ellipse cx="40" cy="65" rx="8" ry="4" fill="#6B3D0A" opacity="0.3" />
        </g>
      )
    case 'invested':
      return <path d="M 34 63 Q 40 66 46 63" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" fill="none" />
    default: // idle
      return <path d="M 32 62 Q 40 67 48 62" stroke="#6B3D0A" strokeWidth="2" strokeLinecap="round" fill="none" />
  }
}

export function CapybaraSvg({ size = 48, emotion = 'idle' }: Props) {
  const earAnim = emotion === 'alert' || emotion === 'idle'

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
      <ellipse
        className={earAnim ? 'capy-ear-l' : undefined}
        cx="22" cy="20" rx="9" ry="7"
        fill={emotion === 'alert' ? '#9A6F2A' : '#7B5B14'}
      />
      <ellipse cx="22" cy="20" rx="5" ry="3.5" fill="#C4874A" />
      <ellipse
        className={earAnim ? 'capy-ear-r' : undefined}
        cx="58" cy="20" rx="9" ry="7"
        fill={emotion === 'alert' ? '#9A6F2A' : '#7B5B14'}
      />
      <ellipse cx="58" cy="20" rx="5" ry="3.5" fill="#C4874A" />

      {/* Body/head */}
      <rect x="8" y="26" width="64" height="42" rx="16" fill="#9A6F2A" />
      <rect x="14" y="30" width="52" height="34" rx="12" fill="#B8852F" />

      {/* Snout */}
      <rect x="18" y="46" width="44" height="20" rx="10" fill="#D4A050" />

      <Eyes emotion={emotion} />

      {/* Nostrils */}
      <ellipse cx="34" cy="56" rx="4" ry="3" fill="#6B3D0A" />
      <ellipse cx="46" cy="56" rx="4" ry="3" fill="#6B3D0A" />

      <Mouth emotion={emotion} />
    </svg>
  )
}
