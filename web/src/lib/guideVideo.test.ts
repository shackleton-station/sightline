import { describe, expect, it } from 'vitest'
import { chaptersFromSteps, chapterTime, parseChapters } from './guideVideo'

describe("the Guide's video chapters", () => {
  it('reads a WebVTT chapters file: each cue is a chapter, by its start and its text', () => {
    const vtt = ['WEBVTT', '', 'NOTE Narration: AI-generated voice', '', 'chapter-1', '00:00:00.000 --> 00:00:09.500', 'The Moon, now', '', '00:09.500 --> 00:21.000', '<v Scout>The markers</v>', '', '01:02:03.250 --> 01:02:10.000', 'Two', 'lines', ''].join('\n')
    expect(parseChapters(vtt)).toEqual([
      { at: 0, title: 'The Moon, now' },
      { at: 9.5, title: 'The markers' },
      { at: 3723.25, title: 'Two lines' },
    ])
  })

  it('gives nothing for a file that is not WebVTT, or a page served in its place', () => {
    expect(parseChapters('<!doctype html><title>Sightline</title>')).toEqual([])
    expect(parseChapters('')).toEqual([])
    expect(parseChapters('WEBVTT\n\nnot a cue\n')).toEqual([])
  })

  it("reads the recorder's list of steps the same way, leaving out what is not a step", () => {
    expect(chaptersFromSteps({ steps: [{ id: 'watch', title: 'The Moon, now', start: 1.2 }, { title: '', start: 3 }, { title: 'No start' }, { title: 'The verdict', start: 31.75 }] })).toEqual([
      { at: 1.2, title: 'The Moon, now' },
      { at: 31.75, title: 'The verdict' },
    ])
    expect(chaptersFromSteps(null)).toEqual([])
    expect(chaptersFromSteps({ steps: 'no' })).toEqual([])
  })

  it('writes a chapter\'s start as minutes and seconds', () => {
    expect(chapterTime(0)).toBe('0:00')
    expect(chapterTime(7.9)).toBe('0:07')
    expect(chapterTime(72)).toBe('1:12')
  })
})
