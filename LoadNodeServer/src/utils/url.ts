export const getServerToServerBaseURL = (): string | null => {
    const nodeEnv = process.env.NODE_ENV || 'development';
    // console.log('NODE_ENV:', nodeEnv);
    if (nodeEnv === 'production') {
        return 'https://memories.brozy.org';
    }
    return 'http://localhost:3000';
};
