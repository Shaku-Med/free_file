export const parseTimeExpression = (timeExpression: string): Date => {
    const now = new Date()
    
    const timeUnits: { [key: string]: number } = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
      'w': 7 * 24 * 60 * 60 * 1000,
      'M': 30 * 24 * 60 * 60 * 1000,
      'y': 365 * 24 * 60 * 60 * 1000
    }
  
    const match = timeExpression.match(/^(\d+)([smhdwMy])$/)
    
    if (!match) {
      throw new Error(`Invalid time expression: ${timeExpression}`)
    }
  
    const value = parseInt(match[1]!)
    const unit = match[2]!
    
    if (!timeUnits[unit]) {
      throw new Error(`Invalid time unit: ${unit}`)
    }
  
    const milliseconds = value * timeUnits[unit]
    return new Date(now.getTime() + milliseconds)
  }
  
  export const getExpirationDate = (expiresIn?: string): Date => {
    const defaultExpiration = '6m'
    const timeExpression = expiresIn || defaultExpiration
    
    try {
      return parseTimeExpression(timeExpression)
    } catch (error) {
      console.error('Error parsing time expression:', error)
      return new Date(Date.now() + 6 * 60 * 1000)
    }
  } 