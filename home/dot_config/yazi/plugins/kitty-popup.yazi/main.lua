-- Keep native previews everywhere except the owned persistent Kitty popup
-- and a Herdr toggle popup.
local M = {}
local next_serial = ya.sync(function(state)
    state.serial = (state.serial or 0) + 1
    return state.serial
end)
-- Counts hover changes, so that the Herdr proxy can drop a late preview.
local hover_count = ya.sync(function(state)
    return state.hover or 0
end)
local function call(helper, args)
    local output, err = Command("python3"):arg({ helper, table.unpack(args) }):output()
    if not output or not output.status.success then
        return nil, tostring(err or (output and output.stderr))
    end
    return ya.json_decode(output.stdout)
end

local function popup_helper()
    if os.getenv("__tmux_popup_name") ~= "yazi_pwd" then
        return
    end
    for _, name in ipairs({ "KITTY_WINDOW_ID", "TMUX", "TMUX_PANE", "YAZI_KITTY_HELPER", "YAZI_KITTY_SOCKET" }) do
        local value = os.getenv(name)
        if not value or value == "" then
            return
        end
    end
    return os.getenv("YAZI_KITTY_HELPER")
end

-- In a Herdr toggle popup, herdr.py sends previews to the popup's proxy,
-- which draws them: Herdr shows no images to the popup's viewer.
local function herdr_helper()
    local value = os.getenv("TOGGLE_POPUP_IMAGE_SOCKET")
    if not value or value == "" then
        return
    end
    local config = os.getenv("YAZI_CONFIG_HOME")
    if not config or config == "" then
        local base = os.getenv("XDG_CONFIG_HOME")
        if not base or base == "" then
            base = os.getenv("HOME") .. "/.config"
        end
        config = base .. "/yazi"
    end
    return config .. "/plugins/kitty-popup.yazi/herdr.py"
end

function M:setup()
    if self.clear_installed then
        return
    end
    if herdr_helper() then
        self.clear_installed = true
        ps.sub("hover", function()
            local hovered = cx.active.current.hovered
            self.hover = (self.hover or 0) + 1
            local file = hovered and tostring(hovered.url) or ""
            ya.emit("plugin", { "kitty-popup", "herdr-clear " .. self.hover .. " " .. ya.quote(file) })
        end)
        return
    end
    if not popup_helper() then
        return
    end
    self.clear_installed = true
    ps.sub("hover", function()
        local hovered = cx.active.current.hovered
        if hovered then
            ya.emit("plugin", { "kitty-popup", "clear " .. ya.quote(tostring(hovered.url)) })
        end
    end)
end

function M:entry(job)
    local herdr = herdr_helper()
    if herdr and job.args[1] == "herdr-clear" and job.args[2] then
        call(herdr, { "clear", job.args[2], job.args[3] or "" })
        return
    end
    local helper = popup_helper()
    if helper and job.args[1] == "clear" and job.args[2] then
        call(helper, { "clear", job.args[2] })
    end
end

-- The plugin that yazi's own rules give the job when this plugin is left
-- out, so every file gets the same previewer, preloader, or spotter as
-- without this plugin. It sets job.args to that rule's args, as yazi does.
local function preset(rules, job)
    for _, rule in pairs(rules:match({ file = job.file, mime = job.mime })) do
        if rule.name ~= "kitty-popup" then
            job.args = rule.args
            return require(rule.name)
        end
    end
end

-- The image that the preset previewer shows: what its preloader makes (an
-- SVG rendered by resvg, a HEIC converted by ImageMagick, a video frame, a
-- smaller copy of a large image), else the file itself.
local function preview_image(job, previewer)
    local start, cache = os.clock(), ya.file_cache(job)
    if cache and previewer.preload then
        local ok, err = previewer:preload(job)
        if not ok or err then
            return nil, err
        end
    end
    ya.sleep(math.max(0, rt.preview.image_delay / 1000 + start - os.clock()))
    if cache then
        local cha = fs.cha(cache)
        if cha and cha.len > 0 then
            return cache
        end
    end
    if job.mime:find("^video/") then
        -- A video has no image without its preloader's frame.
        return nil
    end
    return job.file.path
end

-- Herdr mode: the proxy draws the image, and yazi draws its placeholder cells.
local function herdr_peek(job, helper, previewer)
    if job.area.w < 1 or job.area.h < 1 then
        return
    end
    local hover = hover_count()
    local image, err = preview_image(job, previewer)
    if not image then
        return err and ya.preview_widget(job, err)
    end
    local cache = ya.file_cache(job)
    local data
    data, err = call(helper, {
        "show", tostring(hover), tostring(job.file.url), tostring(image),
        cache and tostring(cache) or "",
        tostring(job.area.x), tostring(job.area.y), tostring(job.area.w), tostring(job.area.h),
        tostring(rt.preview.max_width), tostring(rt.preview.max_height),
    })
    if not data then
        data = { error = err }
    end
    if data.cancelled then
        return
    end
    if data.absent then
        -- The popup is hidden: no proxy draws the image.
        return ya.preview_widget(job, ui.Clear(job.area))
    end
    if data.error then
        return ya.preview_widget(job, ui.Text("Image preview: " .. tostring(data.error)):area(job.area))
    end
    local rows = {}
    for _, row in ipairs(data.rows) do
        rows[#rows + 1] = ui.Line({ ui.Span(row):fg(data.color) })
    end
    ya.preview_widget(job, { ui.Clear(job.area), ui.Text(rows):area(job.area) })
end

function M:peek(job)
    local previewer = preset(rt.plugin.previewers, job)
    if not previewer then
        return
    end
    local herdr = herdr_helper()
    if herdr then
        return herdr_peek(job, herdr, previewer)
    end
    local helper = popup_helper()
    if not helper then
        return previewer:peek(job)
    end
    if job.area.w < 1 or job.area.h < 1 then
        return
    end
    local image, err = preview_image(job, previewer)
    if not image then
        return err and ya.preview_widget(job, err)
    end
    local data = call(helper, {
        "prepare", tostring(next_serial()), tostring(job.file.path), tostring(image),
        tostring(job.area.x), tostring(job.area.y),
        tostring(job.area.w), tostring(job.area.h),
    })
    if not data or data.fallback then
        return previewer:peek(job)
    end
    if data and data.cancelled then
        return
    end
    if data.error then
        return ya.preview_widget(job, ui.Text("Kitty preview: " .. tostring(data.error)):area(job.area))
    end

    local rows = {}
    for _, row in ipairs(data.rows) do
        rows[#rows + 1] = ui.Line({ ui.Span(row):fg(data.color) })
    end
    -- The preview lock rejects a stale job before its token can be committed.
    ya.preview_widget(job, { ui.Clear(job.area), ui.Text(rows):area(job.area) })
    call(helper, { "show", data.token })
end

function M:seek(job)
    local previewer = preset(rt.plugin.previewers, job)
    if previewer and previewer.seek then
        previewer:seek(job)
    end
end

function M:spot(job)
    local spotter = preset(rt.plugin.spotters, job)
    if spotter and spotter.spot then
        spotter:spot(job)
    end
end

return M
