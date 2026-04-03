import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { GitHubClient } from "~/lib/Github/GitHubClient";
import { config } from "~/lib/config";
import { loadImage } from "canvas";
import { deleteOldProfilePicIfNeeded, githubRepoForProfile } from "~/lib/profilePicGithub.server";

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return data({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await isAuthenticated(request, ['id', 'username']);
  if (!user || !user.id) {
    return data({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return data({ error: 'No file provided' }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return data({ error: 'Invalid file type. Only images are allowed' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return data({ error: 'File size exceeds 10MB limit' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let imageWidth: number;
  let imageHeight: number;
  try {
    const image = await loadImage(buffer);
    imageWidth = image.width;
    imageHeight = image.height;
  } catch {
    return data({ error: 'Invalid image file. Could not read image dimensions' }, { status: 400 });
  }

  const aspectRatio = imageWidth / imageHeight;
  const isSquare = Math.abs(aspectRatio - 1) < 0.001;
  if (!isSquare) {
    return data({ error: 'Profile picture must have a square aspect ratio (1:1). Current aspect ratio is not 1:1' }, { status: 400 });
  }

  if (!db) {
    return data({ error: 'Database not available' }, { status: 500 });
  }

  const username = user.username;
  if (!username) {
    return data({ error: 'Username not found' }, { status: 500 });
  }

  const { data: currentUser } = await db
    .from('users')
    .select('profile_pic')
    .eq('id', user.id)
    .maybeSingle();

  if (!config.github.token || !config.github.owner) {
    return data({ error: 'GitHub configuration missing' }, { status: 500 });
  }

  const ghRepo = githubRepoForProfile();
  const githubClient = new GitHubClient(config.github.token, config.github.owner, ghRepo);

  const fileExtension = file.name.split('.').pop() || 'jpg';
  const githubPath = `${username}/${user.id}.${fileExtension}`;

  try {
    const existingSha = await githubClient.getFileSha(githubPath);

    await deleteOldProfilePicIfNeeded(
      githubClient,
      currentUser?.profile_pic,
      githubPath,
      username,
    );

    if (existingSha) {
      await githubClient.deleteFile(githubPath, `Update profile picture for ${username}`);
    }

    await githubClient.uploadFileBuffer(
      githubPath,
      arrayBuffer,
      `Update profile picture for ${username}`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to upload profile picture';
    console.error('Error uploading profile picture (fallback route, no GoUpload):', error);
    return data({ error: message }, { status: 500 });
  }

  const { error: updateError } = await db
    .from('users')
    .update({ profile_pic: githubPath })
    .eq('id', user.id);

  if (updateError) {
    return data({ error: 'Failed to update profile picture in database' }, { status: 500 });
  }

  return data({ success: true, profile_pic: githubPath }, { status: 200 });
};
