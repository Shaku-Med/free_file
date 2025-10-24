// numbers, and letters only, capitalized and lowercases too
// 10 characters long
export const GenerateUniqueID = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}