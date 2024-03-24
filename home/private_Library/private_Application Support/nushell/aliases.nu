# system commands
alias als = help aliases
alias desktop = cd ~/Desktop
alias dskt = cd ~/Desktop
alias l = ls -a
alias ll = ls -al

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
