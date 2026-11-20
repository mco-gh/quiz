// A starter quiz in each language, put in a new host's library on their first
// visit so they can try hosting before adding an API key.
const ANSWERS = [1, 1, 2, 3, 1, 0, 2, 2];   // the same facts in every language

const make = (lang, title, topic, items) => ({
  title, emoji: '🎉', topic, difficulty: 'easy', lang,
  questions: items.map(([q, ...a], i) => ({ q, a, c: ANSWERS[i] })),
});

export const SAMPLES = {
  en: make('en', 'Warm-up mix', 'General knowledge', [
    ['Which planet is known as the Red Planet?', 'Venus', 'Mars', 'Jupiter', 'Mercury'],
    ['How many sides does a hexagon have?', '5', '6', '7', '8'],
    ['Who painted the Mona Lisa?', 'Michelangelo', 'Raphael', 'Leonardo da Vinci', 'Botticelli'],
    ['What is the largest ocean on Earth?', 'Atlantic', 'Indian', 'Arctic', 'Pacific'],
    ['Which gas do plants take in from the air to make food?', 'Oxygen', 'Carbon dioxide', 'Nitrogen', 'Helium'],
    ['In which country is Machu Picchu?', 'Peru', 'Mexico', 'Chile', 'Bolivia'],
    ['What is the chemical symbol for gold?', 'Ag', 'Go', 'Au', 'Gd'],
    ['How many players does a football (soccer) team have on the pitch?', '9', '10', '11', '12'],
  ]),
  fr: make('fr', 'Échauffement', 'Culture générale', [
    ['Quelle planète surnomme-t-on la planète rouge ?', 'Vénus', 'Mars', 'Jupiter', 'Mercure'],
    ['Combien de côtés a un hexagone ?', '5', '6', '7', '8'],
    ['Qui a peint la Joconde ?', 'Michel-Ange', 'Raphaël', 'Léonard de Vinci', 'Botticelli'],
    ['Quel est le plus grand océan du monde ?', 'Atlantique', 'Indien', 'Arctique', 'Pacifique'],
    ['Quel gaz les plantes absorbent-elles dans l’air pour se nourrir ?', 'Oxygène', 'Dioxyde de carbone', 'Azote', 'Hélium'],
    ['Dans quel pays se trouve le Machu Picchu ?', 'Pérou', 'Mexique', 'Chili', 'Bolivie'],
    ['Quel est le symbole chimique de l’or ?', 'Ag', 'Or', 'Au', 'Gd'],
    ['Combien de joueurs une équipe de football a-t-elle sur le terrain ?', '9', '10', '11', '12'],
  ]),
  es: make('es', 'Calentamiento', 'Cultura general', [
    ['¿Qué planeta es conocido como el planeta rojo?', 'Venus', 'Marte', 'Júpiter', 'Mercurio'],
    ['¿Cuántos lados tiene un hexágono?', '5', '6', '7', '8'],
    ['¿Quién pintó la Mona Lisa?', 'Miguel Ángel', 'Rafael', 'Leonardo da Vinci', 'Botticelli'],
    ['¿Cuál es el océano más grande de la Tierra?', 'Atlántico', 'Índico', 'Ártico', 'Pacífico'],
    ['¿Qué gas toman las plantas del aire para alimentarse?', 'Oxígeno', 'Dióxido de carbono', 'Nitrógeno', 'Helio'],
    ['¿En qué país está Machu Picchu?', 'Perú', 'México', 'Chile', 'Bolivia'],
    ['¿Cuál es el símbolo químico del oro?', 'Ag', 'Or', 'Au', 'Gd'],
    ['¿Cuántos jugadores tiene un equipo de fútbol en el campo?', '9', '10', '11', '12'],
  ]),
  de: make('de', 'Aufwärmrunde', 'Allgemeinwissen', [
    ['Welcher Planet wird der Rote Planet genannt?', 'Venus', 'Mars', 'Jupiter', 'Merkur'],
    ['Wie viele Seiten hat ein Sechseck?', '5', '6', '7', '8'],
    ['Wer hat die Mona Lisa gemalt?', 'Michelangelo', 'Raffael', 'Leonardo da Vinci', 'Botticelli'],
    ['Welcher ist der größte Ozean der Erde?', 'Atlantik', 'Indischer Ozean', 'Arktischer Ozean', 'Pazifik'],
    ['Welches Gas nehmen Pflanzen aus der Luft auf, um Nahrung herzustellen?', 'Sauerstoff', 'Kohlendioxid', 'Stickstoff', 'Helium'],
    ['In welchem Land liegt Machu Picchu?', 'Peru', 'Mexiko', 'Chile', 'Bolivien'],
    ['Was ist das chemische Symbol für Gold?', 'Ag', 'Go', 'Au', 'Gd'],
    ['Wie viele Spieler hat eine Fußballmannschaft auf dem Platz?', '9', '10', '11', '12'],
  ]),
};
