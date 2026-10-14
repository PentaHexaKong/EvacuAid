export const time = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Unknown'
export const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
