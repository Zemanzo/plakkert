// How the times a note was changed are shown: in the open note, and in its history.

const sameDay = (a: Date, b: Date) =>
	a.getFullYear() === b.getFullYear() &&
	a.getMonth() === b.getMonth() &&
	a.getDate() === b.getDate();

/**
 * When a note was last changed, briefly: the time today, the day and time this year, or else the
 * day and year.
 */
export function formatEdited(date: Date, now = new Date(), locale?: string) {
	const options: Intl.DateTimeFormatOptions = sameDay(date, now)
		? { hour: 'numeric', minute: '2-digit' }
		: date.getFullYear() === now.getFullYear()
			? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
			: { day: 'numeric', month: 'short', year: 'numeric' };
	return new Intl.DateTimeFormat(locale, options).format(date);
}

/** A version's time in the history: always the day and time, and the year if it's another. */
export function formatVersionTime(date: Date, now = new Date(), locale?: string) {
	return new Intl.DateTimeFormat(locale, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
		hour: 'numeric',
		minute: '2-digit'
	}).format(date);
}

/** The full date and time, e.g. for a tooltip. */
export function formatFullTime(date: Date, locale?: string) {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(date);
}
