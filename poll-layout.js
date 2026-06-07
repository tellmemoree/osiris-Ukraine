const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

client.once('ready', async () => {
    try {
        console.log(`Logged in as ${client.user.tag}`);
        
        let targetChannel = null;
        for (const guild of client.guilds.cache.values()) {
            const channels = await guild.channels.fetch();
            targetChannel = channels.find(c => c.isTextBased() && c.name.toLowerCase().includes('general'));
            if (targetChannel) break;
        }

        if (!targetChannel) {
            console.error('Could not find a general channel.');
            process.exit(1);
        }

        const pollQuestion = 'Do you like the new Minimized Layout on OSIRIS?';
        const pollContent = '**🚨 NEW OSIRIS UPDATE 🚨**\n\nWe just pushed a massive update to OSIRIS at https://www.osirisai.live/ that includes huge bug fixes and a brand new **Minimized UI Layout** for the OSINT and Alert toolkits!\n\nCheck out the new layout and let us know what you think:';

        try {
            await targetChannel.send({
                content: pollContent,
                poll: {
                    question: { text: pollQuestion },
                    answers: [
                        { text: 'Yes, the new layout is super clean! 📱' },
                        { text: 'No, bring back the old one. ⏪' }
                    ],
                    duration: 24,
                    allowMultiselect: false
                }
            });
            console.log('Native poll sent successfully!');
        } catch (pollError) {
            console.log('Native polls not supported, falling back to reactions...');
            const msg = await targetChannel.send(pollContent + '\n\n**' + pollQuestion + '**\n\n👍 : Yes, the new layout is super clean!\n👎 : No, bring back the old one.');
            await msg.react('👍');
            await msg.react('👎');
            console.log('Reaction poll sent successfully!');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error sending poll:', error);
        process.exit(1);
    }
});

client.login(process.env.DISCORD_TOKEN);
