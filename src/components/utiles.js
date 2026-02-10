export function splitIntoSentences(text) {
    if(typeof text!='string'){
        console.log("Le texte fourni n'est pas une chaine de caractères")
    }
       return[];


    return text.match(/[^\.!\?]+[\.!\?]+/g) || [];

}
// foncion pour la séparation des phrases