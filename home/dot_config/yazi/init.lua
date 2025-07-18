-- show user/group of files in status bar
-- ref: https://yazi-rs.github.io/docs/tips/#user-group-in-status
Status:children_add(function()
	local h = cx.active.current.hovered
	if not h or ya.target_family() ~= "unix" then
		return ""
	end

	return ui.Line({
		ui.Span(ya.user_name(h.cha.uid) or tostring(h.cha.uid)):fg("magenta"),
		":",
		ui.Span(ya.group_name(h.cha.gid) or tostring(h.cha.gid)):fg("magenta"),
		" ",
	})
end, 500, Status.RIGHT)

-- show username and hostname in header
-- ref: https://yazi-rs.github.io/docs/tips/#username-hostname-in-header
Header:children_add(function()
	if ya.target_family() ~= "unix" then
		return ""
	end

	return ui.Span(ya.user_name() .. "@" .. ya.host_name() .. ": "):fg("blue")
end, 500, Header.LEFT)
