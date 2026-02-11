export const splitFineName = (filename: string, showLimit?: number) => {
    const chars = Array.from(filename)
    const limited = chars.slice(0, showLimit ?? chars.length)
    return limited
}


interface ParseFilenameProps {
    filename: string,
    showLimit?: number
  }
  
export default function ParseFilenameInsert({ filename, showLimit }: ParseFilenameProps) {
    return (
        <div className="flex flex-wrap">
            {splitFineName(filename, showLimit).map((part, index) => (
                <span key={index} className="inline">
                  <span>{part}</span>
                  {part.trim().length < 1 && <span className="ml-1" />}
                </span>
            ))}
            {showLimit && "..."}
        </div>
    )
}