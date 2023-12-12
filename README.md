## Installation

### Download

You can **[download latest stable release][releases]** (Windows, Mac, and Linux supported)

### Homebrew

```
brew install remove-bg/homebrew-tap/removebg
```

### Installation

Download the .zip or .tar.gz from the [releases page][releases] and unzip with your favorite decompression tool. Then move the binary to a folder in your path.

[releases]: https://github.com/remove-bg/remove-bg-cli/releases/

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

- `--skip-png-format-optimization` - By default the cli calls the API with `zip` format for maximum output resolution. 
When specifying this flag it will use `png` format to save bandwidth by limiting the output resolution to 10 megapixels.


#### Image processing options

Please see the [API documentation][api-docs] for further details.

[api-docs]: https://www.remove.bg/api#operations-tag-Background%20Removal

- `--size` (default `auto`)
- `--type`
- `--channels`
- `--bg-color`
- `--bg-image-file`
- `--format` (default: `png`)
- `--extra-api-option` for forwarding any unlisted/new option to the API
  - Formatted as key/value pair (`=` between key/value)
  - it is possible to use this option multiple times e.g. `--extra-api-option crop=true --extra-api-option add_shadow=true`

## Examples

```sh
# Producing a JPG with a grey background at the path: processed/subject.jpg
removebg subject.jpg --format jpg --bg-color 7a7a7a --output-directory processed

# Producing a large transparent PNG image up to 25 megapixels
removebg large.jpg --size full --format png

# Processing a car image with additional API options
removebg car.jpg --type car --extra-api-option add_shadow=true --extra-api-option semitransparency=true
```

# zip2png

The zip2png command is now included in the remove.bg command line interface. Pass the result zip file from remove.bg as parameter and the command converts it into a transparent png file.

```
removebg zip2png --file /path/to/file.zip 
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
npm run build
./dist/removebg --help
```

### Creating a binary executable

- npm i -g pkg
- npm run build
