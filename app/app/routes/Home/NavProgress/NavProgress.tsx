import { useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const NavProgress = () => {
  const navigation = useNavigation();
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const isNavigating = navigation.state === "loading" || navigation.state === "submitting";

    if (isNavigating) {
      setIsVisible(true);
      setProgress(0);

      let currentProgress = 0;
      const increment = () => {
        if (currentProgress < 90) {
          if (currentProgress < 30) {
            currentProgress += Math.random() * 15 + 5;
          } 
          else if (currentProgress < 70) {
            currentProgress += Math.random() * 8 + 2;
          }
          else {
            currentProgress += Math.random() * 3 + 1;
          }
          
          currentProgress = Math.min(currentProgress, 90);
          setProgress(currentProgress);
        }
      };

      intervalRef.current = setInterval(increment, 150);
    } else {
      if (isVisible) {
        setProgress(100);
        timeoutRef.current = setTimeout(() => {
          setIsVisible(false);
          setProgress(0);
        }, 200);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [navigation.state, isVisible]);

  if (typeof document === "undefined") return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ 
            opacity: 0,
            scaleY: 1.5,
            transition: { duration: 0.2, ease: "easeOut" }
          }}
          className="fixed top-0 left-0 w-full h-1 z-[1000000000000000000]"
          style={{ backgroundColor: "transparent" }}
        >
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="h-full bg-primary"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NavProgress;
