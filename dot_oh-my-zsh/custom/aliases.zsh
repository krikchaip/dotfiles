#** Set personal aliases, overriding those provided by oh-my-zsh libs,
#** plugins, and themes. Aliases can be placed here, though oh-my-zsh
#** users are encouraged to define aliases within the ZSH_CUSTOM folder.
#** For a full list of active aliases, run `alias`.

#** oh my zsh
alias zshconfig="chezmoi edit --apply ~/.zshrc"
alias zshalias="chezmoi edit --apply ~/.oh-my-zsh/custom/aliases.zsh"
alias zshfunc="chezmoi edit --apply ~/.oh-my-zsh/custom/functions.zsh"

#** docker client
alias da="docker attach"
alias db="docker build . --no-cache --progress plain -t \$(basename \$PWD)"
alias de="docker exec -it"
alias di="docker images"
alias dn="docker network"
alias dpa="docker ps -a"
alias dri="docker rmi"
alias drit="docker run -it --rm"
alias drm="docker rm"
alias drma="docker rm -fv \$(docker ps -qa)"
alias dv="docker volume"
alias dvl="docker volume ls"
alias dvp="docker volume prune"

#** docker compose
alias dc="docker compose"
alias dcd="docker compose down"
alias dcpa="docker compose ps -a"
alias dcu="docker compose up"

#** git
alias gfp="git fetch --prune"
alias gwt="git worktree"

#** yarn
alias yd="yarn dev"

#** pnpm
alias pe="pnpm exec"
alias pn="pnpm"
alias px="pnpx"

#** chezmoi
alias cz="chezmoi"
alias cza="chezmoi apply"
alias czi="chezmoi init"
alias czs="chezmoi status"
alias czsr="chezmoi state delete-bucket --bucket scriptState"
alias czst="chezmoi state data"

#** yabai
alias yba="chezmoi apply ~/.config/yabai && yabai --restart-service"
alias ybe="yabai --stop-service"
alias ybs="yabai --start-service"
