import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


export const arrangeDateForThumbnail = (created_at: string) => {
  const date = new Date(created_at)
  const day = date.getUTCDate().toString().padStart(2, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const year = date.getUTCFullYear()
  console.log('day: ', day, 'month: ', month, 'year: ', year)
  return `${day}_${month}_${year}`
}