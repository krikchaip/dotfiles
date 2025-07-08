# system commands
alias mime-type = file --mime-type -b

# homebrew
alias bb = brew bundle --global
alias bbc = brew bundle cleanup --global
alias bo = brew outdated
alias bu = brew upgrade

# eza
alias l = eza --icons --hyperlink --group-directories-first --sort Name -a -TXL 1 (pwd)
alias ll = eza --icons --hyperlink --group-directories-first --sort Name -a -lh --smart-group --time-style=relative --git --git-repos

# zoxide
alias cd = __zoxide_z
alias cdi = __zoxide_zi

# fzf
alias als = fuzzy aliases
alias li = fuzzy ls

# docker client
alias d = docker
alias da = docker attach
alias de = docker exec -it
alias di = docker images
alias dl = docker logs
alias dlf = docker logs -f
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

# kubernetes
alias k = kubectl
alias kd = kubectl describe
alias ke = kubectl exec -it
alias kg = kubectl get
alias kga = kubectl get -A
alias kl = kubectl logs
alias klf = kubectl logs -f
alias mk = minikube
alias mki = minikube image
alias mkk = minikube kubectl --
alias mks = minikube status

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
alias nvc = env NVIM_APPNAME=nvchad nvim
alias nvchad = env NVIM_APPNAME=nvchad nvim
alias neowin = env NVIM_APPNAME=neowin nvim

# tmux
alias t = tmux
alias ta = tmux attach
alias tan = tmux new -A -s
alias tas = tmux attach -t
alias tk = tmux kill-server
alias tl = tmux ls
alias tn = tmux new
alias tns = tmux new -s
