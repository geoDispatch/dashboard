import { describe, expect, it } from 'vitest'

import { ENTRY_SESSION_KEY, readEntrySession, writeEntrySession } from './entrySession'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('entry session', () => {
  it('starts locked when there is no active tab session', () => {
    expect(readEntrySession(memoryStorage())).toBe(false)
  })

  it('remembers and clears only the active-session flag', () => {
    const storage = memoryStorage()

    expect(writeEntrySession(true, storage)).toBe(true)
    expect(storage.getItem(ENTRY_SESSION_KEY)).toBe('active')
    expect(readEntrySession(storage)).toBe(true)

    expect(writeEntrySession(false, storage)).toBe(true)
    expect(readEntrySession(storage)).toBe(false)
  })

  it('fails closed when browser storage is unavailable', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }

    expect(readEntrySession(blocked)).toBe(false)
    expect(writeEntrySession(true, blocked)).toBe(false)
  })
})
