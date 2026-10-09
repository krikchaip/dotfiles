-- Keep native previews everywhere except the owned persistent Kitty popup.
local M = {}
local next_serial = ya.sync(function(state)
    state.serial = (state.serial or 0) + 1
    return state.serial
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

function M:setup()
    if not popup_helper() or self.clear_installed then
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
    local helper = popup_helper()
    if helper and job.args[1] == "clear" and job.args[2] then
        call(helper, { "clear", job.args[2] })
    end
end

function M:peek(job)
    local video = job.mime:find("^video/") ~= nil
    local native = require(video and "video" or "image")
    local helper = popup_helper()
    if not helper then
        return native:peek(job)
    end
    if job.area.w < 1 or job.area.h < 1 then
        return
    end
    local image = job.file.path
    if video then
        local start, cache = os.clock(), ya.file_cache(job)
        if not cache then
            return
        end
        local ok, err = native:preload(job)
        if not ok or err then
            return ya.preview_widget(job, err)
        end
        ya.sleep(math.max(0, rt.preview.image_delay / 1000 + start - os.clock()))
        image = cache
    end
    local data = call(helper, {
        "prepare", tostring(next_serial()), tostring(job.file.path), tostring(image),
        tostring(job.area.x), tostring(job.area.y),
        tostring(job.area.w), tostring(job.area.h),
    })
    if not data or data.fallback then
        return native:peek(job)
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
    require(job.mime:find("^video/") and "video" or "image"):seek(job)
end

function M:spot(job)
    require(job.mime:find("^video/") and "video" or "image"):spot(job)
end

return M
