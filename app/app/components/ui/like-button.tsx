import React, { useState, useCallback } from 'react';
import { useLikeContext } from '../../lib/Context/LikeContext';

interface LikeButtonProps {
  videoId: string;
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  className?: string;
  onLike?: (count: number) => void;
}

export const LikeButton: React.FC<LikeButtonProps> = ({
  videoId,
  size = 'md',
  showCount = true,
  className = '',
  onLike
}) => {
  const { addLike, getUserClickCount } = useLikeContext();
  const [isAnimating, setIsAnimating] = useState(false);
  const [clickAnimation, setClickAnimation] = useState(false);

  const handleClick = useCallback(() => {
    addLike(videoId);
    setIsAnimating(true);
    setClickAnimation(true);
    
    if (onLike) {
      onLike(getUserClickCount(videoId) + 1);
    }

    setTimeout(() => {
      setIsAnimating(false);
      setClickAnimation(false);
    }, 200);
  }, [videoId, addLike, onLike, getUserClickCount]);

  const userClickCount = getUserClickCount(videoId);

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12'
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <button
        onClick={handleClick}
        className={`
          ${sizeClasses[size]}
          flex items-center justify-center
          text-muted-foreground hover:text-red-500
          hover:bg-red-50 dark:hover:bg-red-950/20
          rounded-full transition-all duration-200
          hover:scale-110 active:scale-95
          ${clickAnimation ? 'scale-125 bg-red-100 dark:bg-red-950/30' : ''}
          ${isAnimating ? 'animate-pulse' : ''}
        `}
      >
        <svg
          className={`${iconSizes[size]} transition-all duration-200 ${
            clickAnimation ? 'text-red-500 scale-110' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
        
        {clickAnimation && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
          </div>
        )}
      </button>
      
      {showCount && (
        <span className={`${textSizes[size]} font-medium text-foreground transition-colors duration-200 ${
          clickAnimation ? 'text-red-500' : ''
        }`}>
          {userClickCount > 0 ? `+${userClickCount}` : '0'}
        </span>
      )}
    </div>
  );
};
