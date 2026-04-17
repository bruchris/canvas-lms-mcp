import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function readPackageMetadata(packageJsonUrl = new URL('../package.json', import.meta.url)) {
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8'))
  const { name, version } = packageJson

  if (!name || !version) {
    throw new Error('package.json must define both name and version')
  }

  return { name, version }
}

export function fetchPublishedVersion(
  name,
  { platform = process.platform, execFile = execFileSync, exec = execSync } = {},
) {
  try {
    const stdout =
      platform === 'win32'
        ? exec(`npm.cmd view ${JSON.stringify(name)} version --json`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim()
        : execFile('npm', ['view', name, 'version', '--json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim()

    if (!stdout) {
      return {
        status: 'missing',
        message: `npm registry returned no published version for ${name}; publish allowed`,
      }
    }

    return {
      status: 'published',
      version: JSON.parse(stdout),
    }
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''

    if (stderr.includes('E404')) {
      return {
        status: 'missing',
        message: `npm package ${name} is not published yet; publish allowed`,
      }
    }

    throw error
  }
}

export function verifyPublishVersion({ name, version }, publishedVersion) {
  const currentVersion = parseSemver(version)
  const latestVersion = parseSemver(publishedVersion)

  if (compareSemver(currentVersion, latestVersion) <= 0) {
    throw new Error(
      `Refusing to publish ${name}@${version}: npm already has ${publishedVersion}. Bump above the published version before releasing.`,
    )
  }

  return `Publish version check passed for ${name}: ${version} > ${publishedVersion}`
}

export function runPublishVersionCheck(options = {}) {
  const packageMetadata = readPackageMetadata(options.packageJsonUrl)
  const publishedVersionResult = fetchPublishedVersion(packageMetadata.name, options)

  if (publishedVersionResult.status === 'missing') {
    return publishedVersionResult.message
  }

  return verifyPublishVersion(packageMetadata, publishedVersionResult.version)
}

export function parseSemver(input) {
  const match = String(input).trim().match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  )

  if (!match) {
    throw new Error(`Unsupported semver value: ${input}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  }
}

export function compareSemver(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }

  if (left.patch !== right.patch) {
    return left.patch - right.patch
  }

  if (!left.prerelease && !right.prerelease) {
    return 0
  }

  if (!left.prerelease) {
    return 1
  }

  if (!right.prerelease) {
    return -1
  }

  const leftParts = left.prerelease.split('.')
  const rightParts = right.prerelease.split('.')
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]

    if (leftPart === undefined) {
      return -1
    }

    if (rightPart === undefined) {
      return 1
    }

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : Number.NaN
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : Number.NaN

    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }

    if (Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
      return 1
    }

    if (!Number.isNaN(leftNumber) && Number.isNaN(rightNumber)) {
      return -1
    }

    if (leftPart !== rightPart) {
      return leftPart.localeCompare(rightPart)
    }
  }

  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(runPublishVersionCheck())
}
