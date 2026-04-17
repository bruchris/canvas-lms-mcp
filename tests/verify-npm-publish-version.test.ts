import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  fetchPublishedVersion,
  parseSemver,
  runPublishVersionCheck,
  verifyPublishVersion,
} from '../scripts/verify-npm-publish-version.mjs'

describe('verify-npm-publish-version', () => {
  describe('parseSemver', () => {
    it('parses stable and prerelease versions', () => {
      expect(parseSemver('1.2.3-alpha.4')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'alpha.4',
      })
    })

    it('rejects invalid semver strings', () => {
      expect(() => parseSemver('latest')).toThrow('Unsupported semver value: latest')
    })
  })

  describe('compareSemver', () => {
    it('sorts numeric prerelease identifiers before larger numeric identifiers', () => {
      expect(compareSemver(parseSemver('1.0.0-beta.2'), parseSemver('1.0.0-beta.11'))).toBeLessThan(
        0,
      )
    })

    it('sorts stable releases after prereleases of the same version', () => {
      expect(compareSemver(parseSemver('1.0.0'), parseSemver('1.0.0-rc.1'))).toBeGreaterThan(0)
    })
  })

  describe('fetchPublishedVersion', () => {
    it('returns a missing result when npm reports E404', () => {
      const exec = () => {
        const error = new Error('npm view failed')
        Object.assign(error, { stderr: 'npm ERR! code E404' })
        throw error
      }

      expect(fetchPublishedVersion('canvas-lms-mcp', { platform: 'win32', exec })).toEqual({
        status: 'missing',
        message: 'npm package canvas-lms-mcp is not published yet; publish allowed',
      })
    })

    it('returns the published version when npm responds with JSON', () => {
      const execFile = () => '"1.0.0"'

      expect(fetchPublishedVersion('canvas-lms-mcp', { platform: 'linux', execFile })).toEqual({
        status: 'published',
        version: '1.0.0',
      })
    })
  })

  describe('verifyPublishVersion', () => {
    it('throws when the package version does not exceed the registry version', () => {
      expect(() =>
        verifyPublishVersion({ name: 'canvas-lms-mcp', version: '1.0.0' }, '1.0.0'),
      ).toThrow(
        'Refusing to publish canvas-lms-mcp@1.0.0: npm already has 1.0.0. Bump above the published version before releasing.',
      )
    })

    it('accepts higher prerelease versions', () => {
      expect(
        verifyPublishVersion({ name: 'canvas-lms-mcp', version: '1.0.0-beta.2' }, '1.0.0-beta.1'),
      ).toBe('Publish version check passed for canvas-lms-mcp: 1.0.0-beta.2 > 1.0.0-beta.1')
    })
  })

  describe('runPublishVersionCheck', () => {
    it('returns the publish-allowed message when no registry version is available', () => {
      expect(
        runPublishVersionCheck({
          packageJsonUrl: new URL('./fixtures/verify-version-package.json', import.meta.url),
          platform: 'linux',
          execFile: () => '',
        }),
      ).toBe('npm registry returned no published version for canvas-lms-mcp; publish allowed')
    })

    it('returns the success message when the local version is newer', () => {
      expect(
        runPublishVersionCheck({
          packageJsonUrl: new URL('./fixtures/verify-version-package.json', import.meta.url),
          platform: 'linux',
          execFile: () => '"1.0.0"',
        }),
      ).toBe('Publish version check passed for canvas-lms-mcp: 1.0.1 > 1.0.0')
    })
  })
})
