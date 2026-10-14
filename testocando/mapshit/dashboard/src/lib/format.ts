export const time = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Unknown'
