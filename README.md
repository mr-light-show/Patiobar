# Patiobar

A web frontend for pianobar, which is a console-based client for Pandora.

Provides a simple way for controlling what is playing on the radio.
I use this to allow guests (and myself) to control the music playing
outside on my patio with their phones.

This program was originally written by
[Kyle Johnson](https://github.com/kylejohnson/Patiobar)
and extended and made headless by
[sig-tesla](https://github.com/sig-tesla/Patiobar).
This fork modifies the installation script to create a systemd unit to
automatically start Patiobar at boot time, for dedicated
pianobar/Patiobar devices (such as Raspberry Pis).

## Installation

I have tested this on Raspbian 11 "Bullseye" on a Raspberry Pi 2 and on
Debian 12 "Bookworm" in a virtual environment. I run this under a normal
(non-root) user account, using systemd's user environment and login
lingering to start it at boot. If you are using Raspbian/Debian 11 or
12, these steps should work for you:

Install git, pianobar, and npm:

```bash
sudo apt install git npm pianobar
```

To allow node to bind to port 80:

```bash
sudo setcap cap_net_bind_service=+ep /usr/bin/node
```

After this, you can clone the repo and use the installation script:

```bash
git clone https://github.com/topkecleon/Patiobar
cd Patiobar
./install.sh
```

You will need to edit your pianobar config
(at `~/.config/pianobar/config`) to set your
Pandora username and password.

The installation script will (hopefully) create and enable a systemd
unit file for patiobar to start automatically when the system boots.
To start it for the first time, you can reboot your machine or run:

```bash
systemctl --user start patiobar
```

Connect to your device's IP address in your web browser to access
Patiobar.

## Screenshots

![light mode screenshot](https://i.imgur.com/stkB8dG.jpeg)
![dark mode screenshot](https://i.imgur.com/q5S5XgN.jpeg)
![tools menu screenshot](https://i.imgur.com/X3r9q3u.jpeg)
![station menu screenshot](https://i.imgur.com/ICdVnDV.jpeg)