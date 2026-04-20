import { useEffect, useMemo, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Keyboard, Mousewheel, Virtual } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';
import 'swiper/css/virtual';

import { cn } from '~/lib/utils';
import { VerticalFeedItem } from './VerticalFeedItem';
import type { VerticalFeedItemData } from './types';

interface VerticalFeedContainerProps {
  items: VerticalFeedItemData[];
  initialActiveId?: string;
  onActiveChange?: (item: VerticalFeedItemData, index: number) => void;
  className?: string;
}

export function VerticalFeedContainer({
  items,
  initialActiveId,
  onActiveChange,
  className,
}: VerticalFeedContainerProps) {
  const swiperRef = useRef<SwiperType | null>(null);

  const initialSlide = useMemo(() => {
    if (!initialActiveId) return 0;
    const i = items.findIndex(
      (x) => x.unique_id === initialActiveId || x.id === initialActiveId
    );
    return i >= 0 ? i : 0;
  }, [initialActiveId, items]);

  useEffect(() => {
    const s = swiperRef.current;
    if (!s || !initialActiveId) return;
    const i = items.findIndex(
      (x) => x.unique_id === initialActiveId || x.id === initialActiveId
    );
    if (i >= 0 && i !== s.activeIndex) s.slideTo(i, 0);
  }, [initialActiveId, items]);

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden bg-black',
        className,
        'h-[100dvh] max-h-[100dvh]',
      )}
    >
      <Swiper
        onSwiper={(s) => {
          swiperRef.current = s;
        }}
        onSlideChange={(s) => {
          const item = items[s.activeIndex];
          if (item && onActiveChange) onActiveChange(item, s.activeIndex);
        }}
        modules={[Virtual, Mousewheel, Keyboard]}
        direction="vertical"
        slidesPerView={1}
        initialSlide={initialSlide}
        speed={280}
        longSwipesMs={180}
        threshold={6}
        resistanceRatio={0.35}
        mousewheel={{ forceToAxis: true, thresholdDelta: 20, sensitivity: 1 }}
        keyboard={{ enabled: true, onlyInViewport: true }}
        virtual={{ enabled: true, addSlidesBefore: 1, addSlidesAfter: 1 }}
        className="h-full w-full"
        role="listbox"
        aria-label="Video feed"
      >
        {items.map((item, index) => (
          <SwiperSlide
            key={item.id}
            virtualIndex={index}
            className="!h-full !w-full"
          >
            {({ isActive }) => (
              <div
                id={`feed-item-${item.id}`}
                role="option"
                aria-selected={isActive}
                className="h-full w-full"
              >
                <VerticalFeedItem
                  item={item}
                  isActive={isActive}
                  showChrome={isActive}
                />
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
