interface GradientColorsProps {
    colors: string[]
}

const GradientColors = ({ colors }: GradientColorsProps) => {
    if (colors.length === 0) return null

    return (
        <svg
            className="absolute inset-0 w-full h-full pointer-events-none rounded-4xl overflow-hidden"
            style={{
                opacity: 1,
                mixBlendMode: 'screen',
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid slice"
        >
            <defs>
                <filter id="blur-watery" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="10" />
                    <feColorMatrix type="saturate" values="1.3" />
                    <feComponentTransfer>
                        <feFuncA type="linear" slope="1.2" />
                    </feComponentTransfer>
                </filter>
                {colors.map((color, index) => (
                    <radialGradient key={index} id={`gradient-${index}`} cx="50%" cy="50%">
                        <stop offset="0%" stopColor={color} stopOpacity="0.85" />
                        <stop offset="25%" stopColor={color} stopOpacity="0.6" />
                        <stop offset="50%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="75%" stopColor={color} stopOpacity="0.1" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </radialGradient>
                ))}
            </defs>
            {colors.map((color, index) => {
                const angle = (index / colors.length) * Math.PI * 2
                const baseX = 50 + Math.cos(angle) * 25
                const baseY = 50 + Math.sin(angle) * 25
                const radius = 35 + (index % 3) * 5
                const speed = 8 + (index % 3) * 2
                const delay = index * 0.2
                
                return (
                    <circle
                        key={index}
                        cx={baseX}
                        cy={baseY}
                        r={radius}
                        fill={`url(#gradient-${index})`}
                        filter="url(#blur-watery)"
                        style={{
                            mixBlendMode: 'screen',
                            animation: `wateryFloat ${speed}s ease-in-out infinite`,
                            animationDelay: `${delay}s`,
                        }}
                    />
                )
            })}
            <style>{`
                @keyframes wateryFloat {
                    0%, 100% {
                        transform: translate(0, 0) scale(1);
                    }
                    25% {
                        transform: translate(2%, -1.5%) scale(1.02);
                    }
                    50% {
                        transform: translate(-1.5%, 2%) scale(1.03);
                    }
                    75% {
                        transform: translate(1.5%, 1%) scale(1.01);
                    }
                }
            `}</style>
        </svg>
    )
}

export default GradientColors