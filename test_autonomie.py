import requests

def get_wiki_title():
    try:
        response = requests.get('https://en.wikipedia.org/wiki/Main_Page')
        # Extragem sumar titlul (fără BeautifulSoup pt simplitate)
        text = response.text
        start = text.find('<title>') + 7
        end = text.find('</title>')
        title = text[start:end]
        
        with open('rezultat.txt', 'w', encoding='utf-8') as f:
            f.write(title)
        print(f"Succes! Am salvat: {title}")
    except Exception as e:
        print(f"Eroare: {e}")

if __name__ == '__main__':
    get_wiki_title()
