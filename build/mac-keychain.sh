#!/bin/bash
# Puts a signing certificate in a keychain of its own, for codesign to use.
#
#   P12_PASSWORD=... build/mac-keychain.sh <certificate.p12> <new.keychain-db>
#
# Prints the SHA-1 of the signing identity it holds. afterPack signs with that
# keychain named outright (codesign --keychain), so it is never added to the
# account's keychain search list - and nothing here reads or changes the login
# keychain. The release job runs this, and so does every test suite that signs,
# so the path the release takes is the one the suites have already been down.
#
# The keychain's own password is random and thrown away: it is left unlocked
# for the build and deleted afterwards. The certificate's password comes in by
# environment, never as an argument, where any process could read it.

set -euo pipefail

p12=$1
keychain=$2
: "${P12_PASSWORD:?P12_PASSWORD is not set}"
[ -s "$p12" ] || { echo "no certificate at $p12" >&2; exit 1; }
[ ! -e "$keychain" ] || { echo "$keychain already exists" >&2; exit 1; }

password=$(/usr/bin/openssl rand -hex 24)

# create-keychain adds the new keychain to the search list. Put the list back
# straight away, as it was.
searchlist=()
while IFS= read -r line; do
  line=${line#*\"}
  searchlist+=("${line%\"*}")
done < <(/usr/bin/security list-keychains -d user)
/usr/bin/security create-keychain -p "$password" "$keychain"
/usr/bin/security list-keychains -d user -s ${searchlist[@]+"${searchlist[@]}"}

/usr/bin/security set-keychain-settings "$keychain" # no lock on a timer
/usr/bin/security unlock-keychain -p "$password" "$keychain"
/usr/bin/security import "$p12" -k "$keychain" -f pkcs12 -P "$P12_PASSWORD" -T /usr/bin/codesign >/dev/null
# Without this, codesign stops to ask for the key - a dialog on a laptop and a
# hang on a build machine.
/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" >/dev/null

identity=$(/usr/bin/security find-identity -p codesigning "$keychain" | awk '/^ *1\)/ { print $2; exit }')
[ -n "$identity" ] || { echo "the certificate in $p12 cannot sign code" >&2; exit 1; }
echo "$identity"
