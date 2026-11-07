import { describe, expect, it } from 'vitest'
import {
  formatNowPlaying,
  formatPage,
  formatSearch,
  formatWeather,
  intArg,
  isPrivateAddress,
  MAX_PAGE_CHARS,
  pickPlace,
  pickSpotify,
  splitPlace,
  tidyText,
  WEB_NOTE,
  webUrlProblem,
  weatherWords
} from '../src/shared/builtin'
import { needsAsk, type ToolInfo } from '../src/shared/tools'

describe('weather', () => {
  it('finds the place the user means', () => {
    expect(splitPlace('Utrecht, Netherlands')).toEqual({ name: 'Utrecht', hint: 'netherlands' })
    const results = [
      { name: 'Utrecht', latitude: -27, longitude: 30, country: 'South Africa', country_code: 'ZA' },
      { name: 'Utrecht', latitude: 52.09, longitude: 5.12, country: 'Netherlands', country_code: 'NL', admin1: 'Utrecht' }
    ]
    expect(pickPlace(results, 'netherlands')?.country_code).toBe('NL')
    expect(pickPlace(results, 'nl')?.country_code).toBe('NL')
    expect(pickPlace(results, '')?.country_code).toBe('ZA')
    expect(pickPlace([], 'nl')).toBeNull()
  })

  it('turns the forecast into plain lines', () => {
    const text = formatWeather(
      { name: 'Utrecht', latitude: 52, longitude: 5, country: 'Netherlands', admin1: 'Utrecht' },
      {
        current: { temperature_2m: 11.6, apparent_temperature: 9.2, relative_humidity_2m: 81, precipitation: 0.2, weather_code: 61, wind_speed_10m: 18.4 },
        daily: {
          time: ['2026-11-07', '2026-11-08'],
          weather_code: [61, 3],
          temperature_2m_min: [7.1, 5.5],
          temperature_2m_max: [12.4, 10.1],
          precipitation_probability_max: [80, 20],
          precipitation_sum: [3.2, 0]
        }
      }
    )
    expect(text).toBe(
      [
        'Weather for Utrecht, Netherlands:',
        'Now: light rain, 12 °C (feels like 9 °C), wind 18 km/h, humidity 81%, precipitation 0.2 mm.',
        'Today (2026-11-07): light rain, 7 to 12 °C, 80% chance of rain, 3.2 mm.',
        'Tomorrow (2026-11-08): overcast, 6 to 10 °C, 20% chance of rain.'
      ].join('\n')
    )
    expect(weatherWords(0)).toBe('clear sky')
    expect(weatherWords(42)).toBe('unknown weather')
  })
})

describe('web', () => {
  it('marks results and pages as information, not instructions', () => {
    const text = formatSearch('poppy', { results: [{ title: 'A  page', url: 'https://a.example', content: 'Hello\n\nworld' }] })
    expect(text.startsWith(WEB_NOTE)).toBe(true)
    expect(text).toContain('1. A page\nhttps://a.example\nHello world')
    expect(formatSearch('x', { results: [] })).toBe('No web results for "x".')
    const page = formatPage('https://a.example', { title: 'A', content: 'x'.repeat(MAX_PAGE_CHARS + 10) })
    expect(page.startsWith(WEB_NOTE)).toBe(true)
    expect(page).toMatch(/cut: the page was/)
  })

  it('only reads real web addresses', () => {
    expect(webUrlProblem('https://example.com/a')).toBeNull()
    expect(webUrlProblem('file:///etc/passwd')).toMatch(/Only http/)
    expect(webUrlProblem('http://localhost:11434')).toMatch(/local network/)
    expect(webUrlProblem('http://192.168.1.1')).toMatch(/local network/)
    expect(webUrlProblem('http://172.20.0.1')).toMatch(/local network/)
    expect(webUrlProblem('nope')).toMatch(/not a web address/)
  })
})

describe('reading pages on this Mac', () => {
  it('never reads addresses on this Mac or the local network', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.4', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1'])
      expect(isPrivateAddress(ip), ip).toBe(true)
    for (const ip of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it('tidies page text', () => {
    expect(tidyText('  Title \r\n\n\n\n  Some\t\t text\u00a0here  \n\nEnd ')).toBe('Title\n\nSome text here\n\nEnd')
  })
})

describe('music', () => {
  it("picks Spotify's best hit and says what it is", () => {
    expect(
      pickSpotify(
        { tracks: { items: [{ uri: 'spotify:track:1', name: 'Bohemian Rhapsody', artists: [{ name: 'Queen' }], album: { name: 'A Night at the Opera' } }] } },
        'track'
      )
    ).toEqual({ uri: 'spotify:track:1', label: '"Bohemian Rhapsody" by Queen (from A Night at the Opera)' })
    // Spotify's playlist search can contain nulls.
    expect(pickSpotify({ playlists: { items: [null, { uri: 'spotify:playlist:2', name: 'Focus', owner: { display_name: 'Spotify' } }] } }, 'playlist')).toEqual({
      uri: 'spotify:playlist:2',
      label: 'the playlist "Focus" by Spotify'
    })
    expect(pickSpotify({ tracks: { items: [] } }, 'track')).toBeNull()
  })

  it("describes what's playing", () => {
    expect(formatNowPlaying('playing\tYellow\tColdplay\tParachutes\t266\t65\t70\tfalse\n')).toBe(
      'Playing: "Yellow" by Coldplay (from Parachutes), 1:05 of 4:26. Volume 70%, shuffle off.'
    )
    expect(formatNowPlaying('not running')).toBe("Spotify isn't open.")
    expect(formatNowPlaying('stopped')).toBe('Nothing is playing in Spotify.')
  })

  it("doesn't ask before a harmless music control", () => {
    const tool: ToolInfo = { server: 'music', name: 'music_control', original: 'music_control', description: '', inputSchema: {}, readOnly: false, harmless: true }
    expect(needsAsk(tool, [])).toBe(false)
    expect(needsAsk({ ...tool, harmless: false }, [])).toBe(true)
  })

  it("clamps the model's numbers", () => {
    expect(intArg('80', 0, 100, 50)).toBe(80)
    expect(intArg(140, 0, 100, 50)).toBe(100)
    expect(intArg('loud', 0, 100, 50)).toBe(50)
  })
})
