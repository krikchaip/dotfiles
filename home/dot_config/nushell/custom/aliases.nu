# system commands
alias mime-type = file --mime-type -b
alias desktop = cd ~/Desktop
alias dskt = cd ~/Desktop

# homebrew 
alias bb = brew bundle --global
alias bbc = brew bundle cleanup --global
alias bo = brew outdated
alias bu = brew upgrade

# eza
alias l = eza --icons --hyperlink --group-directories-first --sort Name -a -TXL 1 (pwd)
alias ll = eza --icons --hyperlink --group-directories-first --sort Name -a -lh --smart-group --time-style=relative --git --git-repos

# docker client
alias d = docker
alias da = docker attach
alias de = docker exec -it
alias di = docker images
alias dn = docker network
alias dpa = docker ps -a
alias dr = docker run -it --rm
alias dri = docker rmi
alias drm = docker rm
alias drma = docker rm -fv (docker ps -qa)
alias dv = docker volume
alias dvl = docker volume ls
alias dvp = docker volume prune

# docker compose
alias dc = docker compose
alias dcd = docker compose down
alias dcpa = docker compose ps -a
alias dcu = docker compose up

# chezmoi
alias cz = chezmoi
alias cza = chezmoi apply
alias cze = chezmoi edit
alias czi = chezmoi init
alias czs = chezmoi status

# yabai
alias ybe = yabai --stop-service
alias ybr = yabai --restart-service
alias ybs = yabai --start-service

# skhd
alias ske = skhd --stop-service
alias skr = skhd --restart-service
alias sks = skhd --start-service

# neovim
alias nv = nvim
