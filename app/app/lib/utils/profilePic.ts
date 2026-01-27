export const getProfilePicUrl = (profilePic: string | null | undefined): string | undefined => {
  if (!profilePic) {
    return undefined;
  }
  
  if (profilePic.startsWith('http://') || profilePic.startsWith('https://')) {
    return profilePic;
  }
  
  return `/api/load/profilepic/${profilePic}`;
};
