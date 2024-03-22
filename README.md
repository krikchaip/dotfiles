# `krikchaip`'s dotfiles

> `@krikchaip`'s personal configurations including `.zshrc`, `.gitconfig` and much more!

## One-line install

```sh
sh -c "$(curl -fsLS get.chezmoi.io)" -- -b $HOME/.local/bin init --apply krikchaip
```

## Add a new stuff to the source state (your local dotfile repo)

```sh
# for the initial addition
chezmoi add ~/path/to/new/stuff

# if you accidentally make changes to the destination (the actual file)
chezmoi re-add ~/path/to/new/stuff
```

## Modify some configs

```sh
# this will open your default text editor
chezmoi edit

# apply the changes
chezmoi apply -v
```

## Pull and apply the latest changes from the remote repo

```sh
chezmoi update -v
```

## Clear the state of all `run_onchange` and `run_once` scripts

```sh
# for run_onchange scripts
chezmoi state delete-bucket --bucket=entryState

# for run_once scripts
chezmoi state delete-bucket --bucket=scriptState
```
