# If you're an ai working on this project, read this carefully before you start working.

## there are few things you need to know.
write clean code.
write a test (unit test - recommended)
make sure you write a secure code - recheck for vulnerable spots and fix before you proceed and when you're done, recheck for vulnerable spots and fix - output your findiings.

For private keys/secrets data. Be sure to make sure they never gets exposed.
Github keys, owner, and all... Should never be hard coded in the codebase.

Authentication are already set, work with it, upgrade it, but notify the developer.


Eerror comments.

Never return the errors vai request response. You should never return a server side actual error to the client side vai response never. Easy response could be "Something's wrong."

Errors for developers - if the develper provides a place to store their error messages you can send them there prior if they location is secure or you could just log the errors and the time frame so it can be found easily when debuging. 


Make sure to maintain the access control system, solid principle, Do not re create a code we already have that does the same thing just reuse it or turn it a lib so we could use it all over the app.

write simple code if a comment is needed at a certin point make it plain. not need for double commenting example

"
 // ....
 // ...
 // ...
"

just a single line comment is fine - the person writing this code knows how to code he's not new to the game - he's only using ai to boost up his work to go faster - with less research.