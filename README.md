# remove.bg CLI

[![CircleCI](https://circleci.com/gh/remove-bg/go.svg?style=shield)](https://circleci.com/gh/remove-bg/go)

## Installation

### Download

You can **[download latest stable release][releases]** (Windows, Mac, and Linux supported)

### Homebrew

```
brew install remove-bg/homebrew-tap/removebg
```

### deb / rpm

Download the .deb or .rpm from the [releases page][releases] and install with
`dpkg -i` and `rpm -i`.

For the latest `deb` package supporting `x86-64` you can also run:

```
curl -LO $(curl https://api.github.com/repos/remove-bg/go/releases/latest | grep -o "https://github.com/remove-bg/go/releases/download/.*linux_amd64.deb")
sudo dpkg -i removebg*.deb
```

[releases]: https://github.com/remove-bg/go/releases

## Usage

```
removebg [options] <file>...
```

### API key

To process images you'll need your [remove.bg API key][api-key].

[api-key]: https://www.remove.bg/profile#api-key

To use the API key for all requests you can export the following environment
variable in your shell profile (e.g. `~/.bashrc` / `~/.zshrc`):

```sh
export REMOVE_BG_API_KEY=xyz
```

Alternatively you can specify the API key per command:

```sh
removebg --api-key xyz images/image1.jpg
```

### Processing a directory of images

#### Saving to the same directory (default)

If you want to remove the background from all the PNG and JPG images in a
directory, and save the transparent images in the same directory:

```sh
removebg images/*.{png,jpg}
```

Given the following input:

```
images/
├── dog.jpg
└── cat.png
```

The result would be:

```
images/
├── dog.jpg
├── cat.png
├── dog-removebg.png
└── cat-removebg.png
```

#### Saving to a different directory (`--output-directory`)

If you want to remove the background from all the PNG and JPG images in a
directory, and save the transparent images in a different directory:

```sh
mkdir processed
removebg --output-directory processed originals/*.{png,jpg}
```

Given the following input:

```
originals/
├── dog.jpg
└── cat.png
```

The result would be:

```
originals/
├── dog.jpg
└── cat.png

processed/
├── dog.png
└── cat.png
```

### CLI options

- `--api-key` or `REMOVE_BG_API_KEY` environment variable (required).

- `--output-directory` (optional) - The output directory for processed images.

- `--reprocess-existing` - Images which have already been processed are skipped
by default to save credits. Specify this flag to force reprocessing.

- `--confirm-batch-over` (default `50`) - Prompt for confirmation before
processing batches over this size. Specify `-1` to disable this safeguard.

#### Image processing options

Please see the [API documentation][api-docs] for further details.

[api-docs]: https://www.remove.bg/api#operations-tag-Background%20Removal

- `--size` (default `auto`)
- `--type`
- `--channels`
- `--bg-color`
- `--format` (default: `png`)
- `--extra-api-options` for forwarding any unlisted/new options to the API
  - Formatted as a URI encoded string (`=` between key/value, delimited with `&`)
  - e.g. `--extra-api-options 'crop=true&add_shadow=true'`

## Examples

```sh
# Producing a JPG with a grey background at the path: processed/subject.jpg
removebg subject.jpg --format jpg --bg-color 7a7a7a --output-directory processed

# Producing a large transparent PNG image up to 25 megapixels
removebg large.jpg --size full --format png

# Processing a car image with additional API options
removebg car.jpg --type car --extra-api-options 'add_shadow=true&semitransparency=true'
```

## Development

Prerequisites:

- `nodejs 14.18.1`

Getting started:

```
git clone git@github.com:remove-bg/remove-bg-cli.git
cd remove-bg-cli
npm i
npm run build
npm run test
```

To build & try out locally:

```
go build -o removebg main.go
./removebg --help
```

### Releasing a new version

- Install [goreleaser](https://goreleaser.com/install/)
- [Create a Github token](https://github.com/settings/tokens/new) with repo access
- Run the release script:

```
GITHUB_TOKEN=xyz bin/release vX.Y.Z
```
