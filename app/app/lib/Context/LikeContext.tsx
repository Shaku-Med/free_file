import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface LikeData {
  id: string;
  userClickCount: number;
  lastClickTime: number;
  sessionId: string;
}

interface LikeContextType {
  likeData: Record<string, LikeData>;
  addLike: (id: string) => void;
  getUserClickCount: (id: string) => number;
  sendLikeData: (id: string) => Promise<void>;
  getSessionId: () => string;
}

const LikeContext = createContext<LikeContextType | undefined>(undefined);

export const useLikeContext = () => {
  const context = useContext(LikeContext);
  if (!context) {
    throw new Error('useLikeContext must be used within a LikeProvider');
  }
  return context;
};

interface LikeProviderProps {
  children: React.ReactNode;
}

export const LikeProvider: React.FC<LikeProviderProps> = ({ children }) => {
  const [likeData, setLikeData] = useState<Record<string, LikeData>>({});
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  const addLike = useCallback((id: string) => {
    setLikeData(prev => {
      const current = prev[id] || { id, userClickCount: 0, lastClickTime: 0, sessionId };
      const now = Date.now();
      
      return {
        ...prev,
        [id]: {
          ...current,
          userClickCount: current.userClickCount + 1,
          lastClickTime: now,
          sessionId
        }
      };
    });
  }, [sessionId]);

  const getUserClickCount = useCallback((id: string) => {
    return likeData[id]?.userClickCount || 0;
  }, [likeData]);

  const getSessionId = useCallback(() => {
    return sessionId;
  }, [sessionId]);

  const sendLikeData = useCallback(async (id: string) => {
    const data = likeData[id];
    if (!data || data.userClickCount === 0) return;

    try {
      await fetch('/api/likes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: id,
          userClickCount: data.userClickCount,
          sessionId: data.sessionId,
          timestamp: data.lastClickTime
        }),
      });

      setLikeData(prev => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
    } catch (error) {
      console.error('Failed to send like data:', error);
    }
  }, [likeData]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const timeout = 5000;

      Object.entries(likeData).forEach(([id, data]) => {
        if (now - data.lastClickTime > timeout) {
          sendLikeData(id);
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [likeData, sendLikeData]);

  const value: LikeContextType = {
    likeData,
    addLike,
    getUserClickCount,
    sendLikeData,
    getSessionId
  };

  return (
    <LikeContext.Provider value={value}>
      {children}
    </LikeContext.Provider>
  );
};
