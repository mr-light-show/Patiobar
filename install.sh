#!/usr/bin/env bash
set -euo pipefail

tls_fingerprint=`openssl s_client -connect tuner.pandora.com:443 < /dev/null 2> /dev/null | openssl x509 -noout -fingerprint | tr -d ':' | cut -d'=' -f2`
event_command=${PWD}/eventcmd.sh
fifo=${PWD}/ctl
configdir=~/.config/pianobar
systemd_unit="patiobar.service"
systemd_unit_path=~/.config/systemd/user
systemd_unit_fullname="${systemd_unit_path}/${systemd_unit}"

if ! which npm &> /dev/null; then
	echo "npm is not installed. Exiting."
    exit 1
fi

# Install node packages
echo -n 'Installing node packages...   '
if npm install > /dev/null 2>&1; then
	echo "success"
else
	echo "failure"
	exit 1
fi

# Don't create fifo if it already exists
if [ ! -p "${fifo}" ]; then
	echo -n "Creating ${fifo} control file...   "
	if mkfifo "${fifo}" > /dev/null 2>&1; then
		echo "success"
	else
		echo "failure"
		exit 1
	fi
else
	echo "Control file already exists. Moving on."
fi


if mkdir -p "${configdir}"; then
    if ! [ -f "${configdir}/config" ]; then
		echo -n "Creating default ~/.config/pianobar/config file...   "
		if cat << EOF >> "${configdir}/config"; then
user = user@example.com
password = password
#autostart_station = 123456
audio_quality = high
event_command = ${event_command}
fifo = ${fifo}
tls_fingerprint = ${tls_fingerprint}
EOF
            echo "success"
			echo "You will need to edit ${configdir}/config with your Pandora username and password."
        else
            echo "failure"
        fi
    else
        echo "${configdir}/config already exists"
		echo "You will need to manually update that file."
    fi
else
	echo "Failed to create $configdir."
fi

# Create systemd user folder if it does not exist.
mkdir -p "${systemd_unit_path}"

# Create patiobar.service file if it does not exist.
if [ ! -f "${systemd_unit_fullname}" ]; then
	echo "Creating ${systemd_unit} at ${systemd_unit_path}."
	echo "[Unit]
Description=Patiobar and Pianobar for Pandora.com streaming.

[Service]
Type=forking
RemainAfterExit=yes
WorkingDirectory=${PWD}
ExecStart=/usr/bin/bash -c \"${PWD}/patiobar.sh start\"
ExecStop=/usr/bin/bash -c \"${PWD}/patiobar.sh stop\"
ExecReload=/usr/bin/bash -c \"${PWD}/patiobar.sh restart\"

[Install]
WantedBy=default.target" >> "${systemd_unit_fullname}"
else
	echo "${systemd_unit_fullname} already exists."
fi

# Enable pianobar.service
echo "Enabling ${systemd_unit}..."
systemctl --user enable "${systemd_unit}"

# Enable lingering for current user.
# This means systemd user units will start on boot rather than login.
echo "Enabling user lingering so that systemd units start on boot."
loginctl enable-linger

echo "Done! Patiobar will start on next boot, or start it now with"
echo "  systemctl --user start patiobar.service"
echo "Don't forget to update your pianobar config if necessary."
